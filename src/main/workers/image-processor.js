const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Import threshold settings from parent
const {
  HAMMING_THRESHOLD_UP,
  SSIM_THRESHOLD,
  PIXEL_CHANGE_RATIO_THRESHOLD,
  PIXEL_DIFF_THRESHOLD,
  SSIM_C1_FACTOR,
  SSIM_C2_FACTOR,
  VERIFICATION_COUNT,
  DEBUG_MODE,
  SIZE_IDENTICAL_THRESHOLD,
  SIZE_DIFF_THRESHOLD
} = workerData.constants;

// Cache for preprocessed images to avoid redundant calculations
const preprocessCache = new Map();

// Process a chunk of frame files
async function processFrameChunk(frames, options) {
  const { comparisonMethod, enableDoubleVerification, startIndex } = options;
  
  // Track potential slides in this chunk
  const potentialSlides = [];
  
  // Store the last image buffer for comparison
  let lastImageBuffer = null;
  let potentialNewImageBuffer = null;
  let currentVerification = 0;
  
  try {
    // If this isn't the first chunk, we need the last frame from previous chunk for initial comparison
    if (startIndex > 0 && workerData.previousChunkLastFrame) {
      lastImageBuffer = Buffer.from(workerData.previousChunkLastFrame);
    }
    
    // Process all frames in this chunk
    for (let i = 0; i < frames.length; i++) {
      const framePath = frames[i].fullPath;
      
      // Load the current frame
      const currentImageBuffer = await fs.promises.readFile(framePath);
      
      // Save the first frame of the first chunk directly
      if (lastImageBuffer === null) {
        lastImageBuffer = currentImageBuffer;
        
        // Only report as a slide if this is the very first frame overall
        if (startIndex === 0) {
          potentialSlides.push({
            index: 0,
            buffer: currentImageBuffer,
            frameIndex: i
          });
        }
        
        continue;
      }
      
      // Compare the current frame with the previous frame
      const comparisonResult = await compareImages(lastImageBuffer, currentImageBuffer, comparisonMethod);
      
      // If a change is detected
      if (comparisonResult.changed) {
        if (DEBUG_MODE) {
          console.log(`[Worker] Change detected: ${comparisonResult.method}, Rate of change: ${comparisonResult.changeRatio.toFixed(4)}`);
        }
        
        // If secondary verification is enabled
        if (enableDoubleVerification) {
          if (potentialNewImageBuffer === null) {
            // First detection of change
            potentialNewImageBuffer = currentImageBuffer;
            currentVerification = 1;
          } else if (currentVerification < VERIFICATION_COUNT) {
            // Compare the current frame with the potential new frame
            const verificationResult = await compareImages(potentialNewImageBuffer, currentImageBuffer, comparisonMethod);
            
            if (!verificationResult.changed) {
              // Frame identical, increase verification count
              currentVerification++;
              
              // Reached verification count, save the slide
              if (currentVerification >= VERIFICATION_COUNT) {
                lastImageBuffer = potentialNewImageBuffer;
                
                potentialSlides.push({
                  index: startIndex + i - currentVerification, // Adjust for verification offset
                  buffer: lastImageBuffer,
                  frameIndex: i
                });
                
                // Reset verification status
                potentialNewImageBuffer = null;
                currentVerification = 0;
              }
            } else {
              // Frames are different, update potential new frames
              potentialNewImageBuffer = currentImageBuffer;
              currentVerification = 1;
            }
          }
        } else {
          // Do not use secondary verification, save directly
          lastImageBuffer = currentImageBuffer;
          
          potentialSlides.push({
            index: startIndex + i,
            buffer: currentImageBuffer,
            frameIndex: i
          });
        }
      } else if (potentialNewImageBuffer !== null && enableDoubleVerification) {
        // Compare the current frame with the potential new frame
        const verificationResult = await compareImages(potentialNewImageBuffer, currentImageBuffer, comparisonMethod);
        
        if (!verificationResult.changed) {
          // Frame identical, increase verification count
          currentVerification++;
          
          // Reached verification count, save the slide
          if (currentVerification >= VERIFICATION_COUNT) {
            lastImageBuffer = potentialNewImageBuffer;
            
            potentialSlides.push({
              index: startIndex + i - currentVerification, // Adjust for verification offset
              buffer: lastImageBuffer,
              frameIndex: i
            });
            
            // Reset verification status
            potentialNewImageBuffer = null;
            currentVerification = 0;
          }
        } else {
          // Frames are different, update potential new frames
          potentialNewImageBuffer = currentImageBuffer;
          currentVerification = 1;
        }
      }
    }
    
    // Return the results along with the last frame for boundary handling
    return {
      potentialSlides,
      lastFrame: frames.length > 0 ? await fs.promises.readFile(frames[frames.length-1].fullPath) : null,
      pendingVerification: potentialNewImageBuffer ? {
        buffer: potentialNewImageBuffer,
        currentVerification
      } : null
    };
  } catch (error) {
    console.error('[Worker] Error processing frames:', error);
    throw error;
  }
}

// Compare two images using Sharp - Same implementation as in main.js
async function compareImages(buffer1, buffer2, method = 'default') {
  try {
    // Add file size comparison as initial screening
    const sizeDifference = Math.abs(buffer1.length - buffer2.length);
    const sizeRatio = sizeDifference / Math.max(buffer1.length, buffer2.length);
    
    // If the file sizes are extremely similar (difference less than the threshold), directly determine them as the same image.
    if (sizeRatio < SIZE_IDENTICAL_THRESHOLD) {
      if (DEBUG_MODE) {
        console.log(`File size nearly identical: ${sizeRatio.toFixed(6)}, buffer1: ${buffer1.length}, buffer2: ${buffer2.length}`);
      }
      return {
        changed: false,
        method: 'file-size-identical',
        changeRatio: 0,
        size1: buffer1.length,
        size2: buffer2.length
      };
    }
    
    // If the file size difference exceeds the threshold, directly determine them as different images.
    // Set a 5% file size difference threshold, which can be adjusted according to actual needs.
    if (sizeRatio > SIZE_DIFF_THRESHOLD) {
      if (DEBUG_MODE) {
        console.log(`File size difference detected: ${sizeRatio.toFixed(4)}, buffer1: ${buffer1.length}, buffer2: ${buffer2.length}`);
      }
      return {
        changed: true,
        method: 'file-size',
        changeRatio: sizeRatio,
        size1: buffer1.length,
        size2: buffer2.length
      };
    }
    
    // The file sizes are similar, conducting a more detailed image analysis.
    // Preprocess images only once for both comparison methods
    const { img1, img2, metadata1, metadata2, preprocessedData } = await preprocessImagesForComparison(buffer1, buffer2);
    
    // Use different comparison strategies
    switch (method) {
      case 'basic':
        return await performBasicComparison(img1, img2, metadata1, metadata2, preprocessedData);
      case 'default':
      default:
        return await performPerceptualComparison(img1, img2, metadata1, metadata2, preprocessedData);
    }
  } catch (error) {
    console.error('Image comparison error:', error);
    // If advanced methods fail, fall back to basic comparison
    return { 
      changed: true, 
      method: 'error-fallback',
      changeRatio: 1.0,
      error: error.message
    };
  }
}

// Preprocess images for comparison to avoid redundant operations
async function preprocessImagesForComparison(buffer1, buffer2) {
  // Generate cache keys based on buffer content hashes
  const cacheKey1 = Buffer.from(buffer1).toString('base64').substring(0, 20);
  const cacheKey2 = Buffer.from(buffer2).toString('base64').substring(0, 20);
  
  let preprocessedImg1, preprocessedImg2;
  
  // Try to get preprocessed images from cache
  if (preprocessCache.has(cacheKey1)) {
    preprocessedImg1 = preprocessCache.get(cacheKey1);
  } else {
    // Create Sharp image object
    const img1 = sharp(buffer1);
    const metadata1 = await img1.metadata();
    
    // Common preprocessing for both pHash and SSIM
    const gray1 = await img1.greyscale().raw().toBuffer();
    
    // Prepare different sizes for different algorithms
    const standard32 = await img1.resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer();
    
    preprocessedImg1 = {
      img: img1,
      metadata: metadata1,
      gray: gray1, 
      standard32: standard32
    };
    
    // Store in cache (limit cache size)
    if (preprocessCache.size > 20) {
      // Remove oldest entry when cache gets too large
      const firstKey = preprocessCache.keys().next().value;
      preprocessCache.delete(firstKey);
    }
    
    preprocessCache.set(cacheKey1, preprocessedImg1);
  }
  
  // Same process for the second image
  if (preprocessCache.has(cacheKey2)) {
    preprocessedImg2 = preprocessCache.get(cacheKey2);
  } else {
    const img2 = sharp(buffer2);
    const metadata2 = await img2.metadata();
    
    const gray2 = await img2.greyscale().raw().toBuffer();
    const standard32 = await img2.resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer();
    
    preprocessedImg2 = {
      img: img2,
      metadata: metadata2,
      gray: gray2,
      standard32: standard32
    };
    
    if (preprocessCache.size > 20) {
      const firstKey = preprocessCache.keys().next().value;
      preprocessCache.delete(firstKey);
    }
    
    preprocessCache.set(cacheKey2, preprocessedImg2);
  }
  
  // Return all preprocessed data
  return {
    img1: preprocessedImg1.img,
    img2: preprocessedImg2.img,
    metadata1: preprocessedImg1.metadata,
    metadata2: preprocessedImg2.metadata,
    preprocessedData: {
      gray1: preprocessedImg1.gray,
      gray2: preprocessedImg2.gray,
      standard32_1: preprocessedImg1.standard32,
      standard32_2: preprocessedImg2.standard32
    }
  };
}

// Basic comparison using pixel difference
async function performBasicComparison(img1, img2, metadata1, metadata2, preprocessedData) {
  try {
    // Ensure both images are the same size for comparison
    const width = Math.min(metadata1.width, metadata2.width);
    const height = Math.min(metadata1.height, metadata2.height);
    
    // Use preprocessed grayscale images if they match our size requirements,
    // otherwise create new ones at the required size
    let gray1, gray2;
    
    // Check if we need to resize the preprocessed images
    if (metadata1.width === width && metadata1.height === height && 
        metadata2.width === width && metadata2.height === height) {
      // Can use preprocessed grayscale directly
      gray1 = preprocessedData.gray1;
      gray2 = preprocessedData.gray2;
    } else {
      // Need to resize to matching dimensions
      gray1 = await img1
        .resize(width, height, { fit: 'fill' })
        .greyscale()
        .blur(0.5) // Apply light Gaussian blur for noise reduction
        .raw()
        .toBuffer();
        
      gray2 = await img2
        .resize(width, height, { fit: 'fill' })
        .greyscale()
        .blur(0.5)
        .raw()
        .toBuffer();
    }
    
    // Compare pixels
    const totalPixels = width * height;
    let diffCount = 0;
    
    for (let i = 0; i < totalPixels; i++) {
      const diff = Math.abs(gray1[i] - gray2[i]);
      if (diff > PIXEL_DIFF_THRESHOLD) {
        diffCount++;
      }
    }
    
    const changeRatio = diffCount / totalPixels;
    
    return {
      changed: changeRatio > PIXEL_CHANGE_RATIO_THRESHOLD,
      changeRatio,
      method: 'basic',
      diffCount,
      totalPixels
    };
  } catch (error) {
    console.error('Basic comparison error:', error);
    throw error;
  }
}

// Perceptual comparison using pHash and SSIM
async function performPerceptualComparison(img1, img2, metadata1, metadata2, preprocessedData) {
  try {
    // Calculate perceptual hash using preprocessed data
    const hash1 = await calculatePerceptualHash(img1, preprocessedData.standard32_1);
    const hash2 = await calculatePerceptualHash(img2, preprocessedData.standard32_2);
    
    // Calculate Hamming distance
    const hammingDistance = calculateHammingDistance(hash1, hash2);
    
    if (DEBUG_MODE) {
      console.log(`pHash comparison: Hamming distance = ${hammingDistance}`);
    }
    
    if (hammingDistance > HAMMING_THRESHOLD_UP) {
      // Hash significantly different
      return {
        changed: true,
        changeRatio: hammingDistance / 64, // 64-bit hash
        method: 'pHash',
        distance: hammingDistance
      };
    } else if (hammingDistance === 0) {
      // Completely identical hash
      return {
        changed: false,
        changeRatio: 0,
        method: 'pHash',
        distance: 0
      };
    } else {
      // Boundary conditions, using SSIM-like analysis
      const ssim = await calculateSSIM(img1, img2, metadata1, metadata2, preprocessedData);
      
      if (DEBUG_MODE) {
        console.log(`SSIM similarity: ${ssim.toFixed(6)}`);
      }
      
      return {
        changed: ssim < SSIM_THRESHOLD,
        changeRatio: 1.0 - ssim,
        method: 'SSIM-like',
        similarity: ssim
      };
    }
  } catch (error) {
    console.error('Perceptual comparison error:', error);
    // Fall back to basic method
    return performBasicComparison(img1, img2, metadata1, metadata2, preprocessedData);
  }
}

// Calculate perceptual hash
async function calculatePerceptualHash(img, preprocessedData) {
  try {
    // Use preprocessed 32x32 grayscale data if available
    const data = preprocessedData || await img
      .resize(32, 32, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();
    
    // Convert raw pixel data to 2D array for DCT
    const pixels = new Array(32);
    for (let y = 0; y < 32; y++) {
      pixels[y] = new Array(32);
      for (let x = 0; x < 32; x++) {
        pixels[y][x] = data[y * 32 + x];
      }
    }
    
    // Apply DCT
    const dct = applySimplifiedDCT(pixels, 32);
    
    // Generate hash from low-frequency components
    const hashSize = 8;
    const dctLowFreq = [];
    
    for (let y = 0; y < hashSize; y++) {
      for (let x = 0; x < hashSize; x++) {
        if (!(x === 0 && y === 0)) { // Skip DC component
          dctLowFreq.push(dct[y][x]);
        }
      }
    }
    
    // Find median value
    dctLowFreq.sort((a, b) => a - b);
    const medianValue = dctLowFreq[Math.floor(dctLowFreq.length / 2)];
    
    // Generate binary hash
    let hash = '';
    for (let y = 0; y < hashSize; y++) {
      for (let x = 0; x < hashSize; x++) {
        if (!(x === 0 && y === 0)) {
          hash += (dct[y][x] >= medianValue) ? '1' : '0';
        }
      }
    }
    
    return hash;
  } catch (error) {
    console.error('pHash calculation error:', error);
    throw error;
  }
}

// Simplified DCT implementation
function applySimplifiedDCT(pixels, size) {
  const result = Array(size).fill().map(() => Array(size).fill(0));
  
  for (let u = 0; u < size; u++) {
    for (let v = 0; v < size; v++) {
      let sum = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const cosX = Math.cos((2 * x + 1) * u * Math.PI / (2 * size));
          const cosY = Math.cos((2 * y + 1) * v * Math.PI / (2 * size));
          sum += pixels[y][x] * cosX * cosY;
        }
      }
      
      // Apply weight factors
      const cu = (u === 0) ? 1 / Math.sqrt(2) : 1;
      const cv = (v === 0) ? 1 / Math.sqrt(2) : 1;
      result[u][v] = sum * cu * cv * (2 / size);
    }
  }
  
  return result;
}

// Calculate Hamming Distance
function calculateHammingDistance(hash1, hash2) {
  if (hash1.length !== hash2.length) {
    throw new Error('Hash length mismatch');
  }
  
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  
  return distance;
}

// Calculate SSIM-like metric
async function calculateSSIM(img1, img2, metadata1, metadata2, preprocessedData) {
  try {
    // Use preprocessed images if available and appropriate size
    const width = metadata1.width;
    const height = metadata1.height;
    
    // Check if we already have grayscale images of the right size in preprocessedData
    let gray1, gray2;
    if (preprocessedData && width === metadata1.width && height === metadata1.height) {
      gray1 = preprocessedData.gray1;
      gray2 = preprocessedData.gray2;
    } else {
      // Convert to grayscale for comparison
      gray1 = await img1
        .resize(width, height)
        .greyscale()
        .raw()
        .toBuffer();
        
      gray2 = await img2
        .resize(width, height)
        .greyscale()
        .raw()
        .toBuffer();
    }
    
    // Calculate the mean
    let mean1 = 0, mean2 = 0;
    const pixelCount = width * height;
    
    for (let i = 0; i < pixelCount; i++) {
      mean1 += gray1[i];
      mean2 += gray2[i];
    }
    
    mean1 /= pixelCount;
    mean2 /= pixelCount;
    
    // Calculate variance and covariance
    let var1 = 0, var2 = 0, covar = 0;
    for (let i = 0; i < pixelCount; i++) {
      const diff1 = gray1[i] - mean1;
      const diff2 = gray2[i] - mean2;
      var1 += diff1 * diff1;
      var2 += diff2 * diff2;
      covar += diff1 * diff2;
    }
    
    var1 /= pixelCount;
    var2 /= pixelCount;
    covar /= pixelCount;
    
    // Stability constants
    const C1 = SSIM_C1_FACTOR * 255 * SSIM_C1_FACTOR * 255;
    const C2 = SSIM_C2_FACTOR * 255 * SSIM_C2_FACTOR * 255;
    
    // Calculate SSIM
    const numerator = (2 * mean1 * mean2 + C1) * (2 * covar + C2);
    const denominator = (mean1 * mean1 + mean2 * mean2 + C1) * (var1 + var2 + C2);
    
    return numerator / denominator;
  } catch (error) {
    console.error('SSIM calculation error:', error);
    throw error;
  }
}

// Handle messages from the main thread
parentPort.on('message', async (message) => {
  if (message.type === 'process') {
    try {
      const result = await processFrameChunk(message.frames, message.options);
      parentPort.postMessage({ type: 'result', result });
    } catch (error) {
      parentPort.postMessage({ type: 'error', error: error.message });
    }
  }
});

// Worker started
parentPort.postMessage({ type: 'ready' });
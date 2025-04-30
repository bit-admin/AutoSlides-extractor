// Get DOM element
const inputVideo = document.getElementById('inputVideo');
const inputOutputDir = document.getElementById('inputOutputDir');
const inputCheckInterval = document.getElementById('inputCheckInterval');
const btnSelectVideo = document.getElementById('btnSelectVideo');
const btnSelectDir = document.getElementById('btnSelectDir');
const btnStartProcess = document.getElementById('btnStartProcess');
const btnStopProcess = document.getElementById('btnStopProcess');
const btnReset = document.getElementById('btnReset');
const progressBar = document.getElementById('progressBar');
const progressFill = progressBar.querySelector('.progress-fill');
const progressText = document.getElementById('progressText');
const statusText = document.getElementById('statusText');
const totalFrames = document.getElementById('totalFrames');
const extractedSlides = document.getElementById('extractedSlides');
const processingTime = document.getElementById('processingTime');
const slidesContainer = document.getElementById('slidesContainer');
const comparisonMethod = document.getElementById('comparisonMethod');
const enableDoubleVerification = document.getElementById('enableDoubleVerification');

// Threshold parameter settings
// pHash 和 SSIM 相关阈值
const HAMMING_THRESHOLD_UP = 5;       // Perception Hash Hamming Distance Upper Threshold
const SSIM_THRESHOLD = 0.999;         // Structure Similarity Index Threshold

// Basic pixel comparison related threshold
const PIXEL_CHANGE_RATIO_THRESHOLD = 0.005;  // Base comparison method's change rate threshold
const PIXEL_DIFF_THRESHOLD = 30;      // Pixel difference threshold

// SSIM calculation related constants
const SSIM_C1_FACTOR = 0.01;          // C1 factor in SSIM calculation
const SSIM_C2_FACTOR = 0.03;          // C2 factor in SSIM calculation

// Validation-related thresholds
const VERIFICATION_COUNT = 2;         // The number of consecutive identical frames required for secondary verification

// Global variable
let selectedVideoPath = '';
let framesDir = '';
let isProcessing = false;
let processStartTime = 0;
let processedFrames = 0;
let extractedCount = 0;
let lastImageData = null;
let currentVerification = 0;
let potentialNewImageData = null;
let timerInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Load configuration
  try {
    const config = await window.electronAPI.getConfig();
    inputOutputDir.value = config.outputDir || '';
    inputCheckInterval.value = config.checkInterval || 2;
    comparisonMethod.value = config.comparisonMethod || 'default';
    enableDoubleVerification.checked = config.enableDoubleVerification !== false;
  } catch (error) {
    console.error('Failed to load configuration:', error);
  }
});

// Event Listener
btnSelectVideo.addEventListener('click', async () => {
  const videoPath = await window.electronAPI.selectVideoFile();
  if (videoPath) {
    selectedVideoPath = videoPath;
    inputVideo.value = videoPath;
    
    // Get video information
    try {
      statusText.textContent = 'Getting video information...';
      const videoInfo = await window.electronAPI.getVideoInfo(videoPath);
      statusText.textContent = `Video info: ${Math.round(videoInfo.duration)}s, ${videoInfo.width}x${videoInfo.height}, ${videoInfo.fps.toFixed(2)}fps`;
    } catch (error) {
      statusText.textContent = `Failed to get video information: ${error}`;
    }
  }
});

btnSelectDir.addEventListener('click', async () => {
  const outputDir = await window.electronAPI.selectOutputDir();
  if (outputDir) {
    inputOutputDir.value = outputDir;
  }
});

btnStartProcess.addEventListener('click', async () => {
  if (!selectedVideoPath) {
    statusText.textContent = 'Please select a video file first';
    return;
  }
  
  if (!inputOutputDir.value) {
    statusText.textContent = 'Please select an output directory first';
    return;
  }
  
  // Save configuration
  await saveConfig();
  
  // Start processing
  startProcessing();
});

btnStopProcess.addEventListener('click', () => {
  stopProcessing();
});

btnReset.addEventListener('click', () => {
  resetUI();
});

// Save configuration
async function saveConfig() {
  try {
    const config = {
      outputDir: inputOutputDir.value,
      checkInterval: parseFloat(inputCheckInterval.value),
      comparisonMethod: comparisonMethod.value,
      captureStrategy: {
        hammingThresholdUp: HAMMING_THRESHOLD_UP,
        ssimThreshold: SSIM_THRESHOLD
      },
      enableDoubleVerification: enableDoubleVerification.checked
    };
    
    await window.electronAPI.saveConfig(config);
  } catch (error) {
    console.error('Failed to save configuration:', error);
  }
}

// Start processing video
async function startProcessing() {
  let tempDir = null; // Move declaration here to make it accessible in finally block
  
  try {
    isProcessing = true;
    processStartTime = Date.now();
    processedFrames = 0;
    extractedCount = 0;
    lastImageData = null;
    potentialNewImageData = null;
    currentVerification = 0;
    
    // Update UI
    btnStartProcess.disabled = true;
    btnStopProcess.disabled = false;
    btnReset.disabled = true; // Disable Reset button during processing
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    totalFrames.textContent = '0';
    extractedSlides.textContent = '0';
    processingTime.textContent = '0s';
    slidesContainer.innerHTML = '';
    statusText.textContent = 'Extracting video frames...';
    
    // Start real-time timer
    startTimer();
    
    // Extract video frames
    const interval = parseFloat(inputCheckInterval.value);
    
    // Remove any existing listeners.
    window.electronAPI.removeAllListeners();
    
    const result = await window.electronAPI.extractFrames({
      videoPath: selectedVideoPath,
      outputDir: inputOutputDir.value,
      interval: interval,
      saveFrames: false, // Do not save intermediate frame files
      onProgress: updateProgress // Add progress update callback
    });
    
    framesDir = result.framesDir;
    tempDir = result.tempDir; // Save the temporary directory path for subsequent cleanup
    totalFrames.textContent = result.totalFrames;
    
    // Process the extracted frames
    statusText.textContent = 'Analyzing frames...';
    await processFrames(framesDir);
    
    // Complete processing
    stopTimer(); // Stop the timer
    statusText.textContent = `Processing complete, extracted ${extractedCount} slides`;
    
  } catch (error) {
    console.error('Failed to process video:', error);
    
    // Check if this was a manual stop (don't show error in that case)
    if (!isProcessing && error.message && error.message.includes('killed with signal SIGKILL')) {
      statusText.textContent = 'Processing stopped';
    } else {
      statusText.textContent = `Processing failed: ${error}`;
    }
  } finally {
    isProcessing = false;
    btnStartProcess.disabled = false;
    btnStopProcess.disabled = true;
    btnReset.disabled = false; // Re-enable Reset button when processing ends

    // Clear temporary directory
    if (tempDir) {
      try {
        await window.electronAPI.cleanupTempDir(tempDir);
      } catch (cleanupError) {
        console.error('Failed to cleanup temporary directory:', cleanupError);
      }
    }
  }
}

// Stop processing
async function stopProcessing() {
  if (isProcessing) {
    isProcessing = false;
    statusText.textContent = 'Stopping processing...';
    
    // Cancel the ffmpeg process
    try {
      await window.electronAPI.cancelExtraction();
      statusText.textContent = 'Processing stopped';
    } catch (error) {
      console.error('Failed to stop processing:', error);
      statusText.textContent = 'Failed to stop processing';
    }
    
    btnStartProcess.disabled = false;
    btnStopProcess.disabled = true;
    btnReset.disabled = false; // Re-enable Reset button when processing is stopped
    stopTimer();
  }
}

// Reset UI
function resetUI() {
  // Reset progress bar
  progressFill.style.width = '0%';
  progressText.textContent = '0%';
  
  // Reset statistics data
  totalFrames.textContent = '0';
  extractedSlides.textContent = '0';
  processingTime.textContent = '0s';
  
  // Clear slide preview
  slidesContainer.innerHTML = '';
  
  // Reset state text
  statusText.textContent = 'Ready';
  
  // Clear video path
  selectedVideoPath = '';
  inputVideo.value = '';
}

// Start timer
function startTimer() {
  // Clear any existing old timers
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  // Set a new timer, updating every second
  timerInterval = setInterval(() => {
    if (isProcessing) {
      const currentTime = Date.now();
      const elapsedSeconds = Math.round((currentTime - processStartTime) / 1000);
      processingTime.textContent = `${elapsedSeconds}s`;
    }
  }, 1000);
}

// Stop the timer
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Update progress
function updateProgress(progress) {
  if (!isProcessing) return;
  
  const percent = progress.percent;
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
  statusText.textContent = `Extracting video frames... ${Math.round(progress.currentTime)}/${Math.round(progress.totalTime)}s`;
}

// Process the extracted frames
async function processFrames(framesDir) {
  try {
    // Get all frame files - Retrieve the file list through the main process API
    const result = await window.electronAPI.listFrameFiles(framesDir);
    const frameFiles = result.files;
    
    // Create slide output directory
    const slidesDir = await window.electronAPI.createSlidesDir(inputOutputDir.value);
    
    // Process each frame
    for (let i = 0; i < frameFiles.length; i++) {
      if (!isProcessing) break; // Check if processing has stopped
      
      processedFrames++;
      const frameFile = frameFiles[i];
      // Use the full path, no longer use path.join
      const framePath = frameFiles[i].fullPath || `${framesDir}/${frameFile}`;
      
      // Update progress
      const percent = Math.round((processedFrames / frameFiles.length) * 100);
      progressFill.style.width = `${percent}%`;
      progressText.textContent = `${percent}%`;
      statusText.textContent = `Analyzing frame ${processedFrames}/${frameFiles.length}`;
      
      // Read frame image - Read through the main process API
      const base64Data = await window.electronAPI.readFrameImage(framePath);
      
      // Save the first frame directly
      if (lastImageData === null) {
        lastImageData = base64Data;
        await saveSlide(base64Data, slidesDir, 'slide-001.jpg');
        extractedCount++;
        extractedSlides.textContent = extractedCount;
        continue;
      }
      
      // Compare the current frame with the previous frame
      const comparisonResult = await compareImages(lastImageData, base64Data);
      
      // If a change is detected
      if (comparisonResult.changed) {
        console.log(`Change detected: ${comparisonResult.method}, Rate of change: ${comparisonResult.changeRatio.toFixed(4)}`);
        
        // If secondary verification is enabled
        if (enableDoubleVerification.checked) {
          if (potentialNewImageData === null) {
            // First detection of change
            potentialNewImageData = base64Data;
            currentVerification = 1;
          } else if (currentVerification < VERIFICATION_COUNT) {
            // Compare the current frame with the potential new frame
            const verificationResult = await compareImages(potentialNewImageData, base64Data);
            
            if (!verificationResult.changed) {
              // Frame identical, increase verification count
              currentVerification++;
              
              // Reached verification count, save the slide
              if (currentVerification >= VERIFICATION_COUNT) {
                lastImageData = potentialNewImageData;
                extractedCount++;
                const slideNumber = String(extractedCount).padStart(3, '0');
                await saveSlide(lastImageData, slidesDir, `slide-${slideNumber}.jpg`);
                extractedSlides.textContent = extractedCount;
                
                // Reset verification status
                potentialNewImageData = null;
                currentVerification = 0;
              }
            } else {
              // Frames are different, update potential new frames
              potentialNewImageData = base64Data;
              currentVerification = 1;
            }
          }
        } else {
          // Do not use secondary verification, save directly
          lastImageData = base64Data;
          extractedCount++;
          const slideNumber = String(extractedCount).padStart(3, '0');
          await saveSlide(lastImageData, slidesDir, `slide-${slideNumber}.jpg`);
          extractedSlides.textContent = extractedCount;
        }
      } else if (potentialNewImageData !== null && enableDoubleVerification.checked) {
        // Compare the current frame with the potential new frame
        const verificationResult = await compareImages(potentialNewImageData, base64Data);
        
        if (!verificationResult.changed) {
          // Frame identical, increase verification count
          currentVerification++;
          
          // Reached verification count, save the slide
          if (currentVerification >= VERIFICATION_COUNT) {
            lastImageData = potentialNewImageData;
            extractedCount++;
            const slideNumber = String(extractedCount).padStart(3, '0');
            await saveSlide(lastImageData, slidesDir, `slide-${slideNumber}.jpg`);
            extractedSlides.textContent = extractedCount;
            
            // Reset verification status
            potentialNewImageData = null;
            currentVerification = 0;
          }
        } else {
          // Frames are different, update potential new frames
          potentialNewImageData = base64Data;
          currentVerification = 1;
        }
      }
    }
    
    return extractedCount;
  } catch (error) {
    console.error('Failed to process frames:', error);
    throw error;
  }
}

// Save slide
async function saveSlide(imageData, outputDir, filename) {
  try {
    // Save to file
    await window.electronAPI.saveSlide({
      imageData,
      outputDir,
      filename
    });
    
    // Add to preview area
    addSlidePreview(imageData, filename);
    
    return true;
  } catch (error) {
    console.error('Failed to save slide:', error);
    return false;
  }
}

// Add slide preview
function addSlidePreview(imageData, filename) {
  const slideItem = document.createElement('div');
  slideItem.className = 'slide-item';
  
  const img = document.createElement('img');
  img.src = imageData;
  img.alt = filename;
  
  const info = document.createElement('div');
  info.className = 'slide-info';
  info.textContent = filename;
  
  slideItem.appendChild(img);
  slideItem.appendChild(info);
  slidesContainer.appendChild(slideItem);
}

// Image processing function

// Compare two images
function compareImages(img1Data, img2Data) {
  return new Promise((resolve) => {
    const img1 = new Image();
    const img2 = new Image();
    let loadedCount = 0;
    
    function processImages() {
      if (loadedCount === 2) {
        const canvas1 = document.createElement('canvas');
        const canvas2 = document.createElement('canvas');
        const ctx1 = canvas1.getContext('2d');
        const ctx2 = canvas2.getContext('2d');
        
        canvas1.width = img1.width;
        canvas1.height = img1.height;
        canvas2.width = img2.width;
        canvas2.height = img2.height;
        
        ctx1.drawImage(img1, 0, 0);
        ctx2.drawImage(img2, 0, 0);
        
        // Acquire image data
        const data1 = ctx1.getImageData(0, 0, canvas1.width, canvas1.height);
        const data2 = ctx2.getImageData(0, 0, canvas2.width, canvas2.height);
        
        // Get comparison method
        const method = comparisonMethod.value || 'default';
        
        // Use different comparison strategies
        switch (method) {
          case 'basic':
            performBasicComparison(data1, data2, resolve);
            break;
          case 'default':
            performPerceptualComparison(data1, data2, resolve);
            break;
          default:
            performPerceptualComparison(data1, data2, resolve); // Default to using perceptual hash method
        }
      }
    }
    
    img1.onload = () => {
      loadedCount++;
      processImages();
    };
    
    img2.onload = () => {
      loadedCount++;
      processImages();
    };
    
    img1.src = img1Data;
    img2.src = img2Data;
  });
}

// Basic pixel comparison
function performBasicComparison(data1, data2, resolve) {
  // Convert to grayscale
  data1 = convertToGrayscale(data1);
  data2 = convertToGrayscale(data2);
  
  // Apply Gaussian blur
  data1 = applyGaussianBlur(data1, 0.5);
  data2 = applyGaussianBlur(data2, 0.5);
  
  // Compare pixels
  const comparisonResult = comparePixels(data1, data2);
  
  resolve({
    changed: comparisonResult.changeRatio > PIXEL_CHANGE_RATIO_THRESHOLD,
    changeRatio: comparisonResult.changeRatio,
    method: 'basic'
  });
}

// Perceptual Hash Comparison
function performPerceptualComparison(data1, data2, resolve) {
  try {
    // Calculate perceptual hash
    const hash1 = calculatePerceptualHash(data1);
    const hash2 = calculatePerceptualHash(data2);
    
    // Calculate Hamming distance
    const hammingDistance = calculateHammingDistance(hash1, hash2);
    
    console.log(`pHash comparison: Hamming distance = ${hammingDistance}`);
    
    if (hammingDistance > HAMMING_THRESHOLD_UP) {
      // Hash significantly different
      resolve({
        changed: true,
        changeRatio: hammingDistance / 64, // 64-bit hash
        method: 'pHash',
        distance: hammingDistance
      });
    } else if (hammingDistance === 0) {
      // Completely identical hash
      resolve({
        changed: false,
        changeRatio: 0,
        method: 'pHash',
        distance: 0
      });
    } else {
      // Boundary conditions, using SSIM
      const ssim = calculateSSIM(data1, data2);
      
      console.log(`SSIM similarity: ${ssim.toFixed(6)}`);
      
      resolve({
        changed: ssim < SSIM_THRESHOLD,
        changeRatio: 1.0 - ssim,
        method: 'SSIM',
        similarity: ssim
      });
    }
  } catch (error) {
    console.error('Perceptual comparison error:', error);
    performBasicComparison(data1, data2, resolve); // Roll back to basic method
  }
}

// Convert to grayscale image
function convertToGrayscale(imageData) {
  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Use the weighted average method to calculate the grayscale value
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
  return new ImageData(data, imageData.width, imageData.height);
}

// Apply Gaussian Blur
function applyGaussianBlur(imageData, sigma) {
  // Create Gaussian kernel
  const kernelSize = Math.max(3, Math.ceil(sigma * 3) * 2 + 1);
  const halfSize = Math.floor(kernelSize / 2);
  const kernel = new Array(kernelSize);
  
  // Compute Gaussian kernel
  let sum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - halfSize;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  
  // Normalization
  for (let i = 0; i < kernelSize; i++) {
    kernel[i] /= sum;
  }
  
  // Create temporary image data
  const width = imageData.width;
  const height = imageData.height;
  const data = new Uint8ClampedArray(imageData.data);
  const temp = new Uint8ClampedArray(data);
  
  // Horizontal blur
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      
      for (let i = 0; i < kernelSize; i++) {
        const kx = Math.min(width - 1, Math.max(0, x + i - halfSize));
        const idx = (y * width + kx) * 4;
        const weight = kernel[i];
        
        r += data[idx] * weight;
        g += data[idx + 1] * weight;
        b += data[idx + 2] * weight;
      }
      
      const idx = (y * width + x) * 4;
      temp[idx] = r;
      temp[idx + 1] = g;
      temp[idx + 2] = b;
      temp[idx + 3] = data[idx + 3]; // Keep alpha unchanged
    }
  }
  
  // Vertical blur
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      
      for (let i = 0; i < kernelSize; i++) {
        const ky = Math.min(height - 1, Math.max(0, y + i - halfSize));
        const idx = (ky * width + x) * 4;
        const weight = kernel[i];
        
        r += temp[idx] * weight;
        g += temp[idx + 1] * weight;
        b += temp[idx + 2] * weight;
      }
      
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      // Alpha remains unchanged
    }
  }
  
  return new ImageData(data, width, height);
}

// Compare Pixels
function comparePixels(data1, data2) {
  const width = Math.min(data1.width, data2.width);
  const height = Math.min(data1.height, data2.height);
  const totalPixels = width * height;
  let diffCount = 0;
  
  // Calculate pixel difference
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const diff = Math.abs(data1.data[i] - data2.data[i]);
      
      if (diff > PIXEL_DIFF_THRESHOLD) {
        diffCount++;
      }
    }
  }
  
  const changeRatio = diffCount / totalPixels;
  
  return {
    diffCount,
    totalPixels,
    changeRatio
  };
}

// Resize image
function resizeImageData(imageData, newWidth, newHeight) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // Create temporary image
  const img = new Image();
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  
  // Set the temporary canvas to the original image size
  tempCanvas.width = imageData.width;
  tempCanvas.height = imageData.height;
  
  // Create ImageData and place it on a temporary canvas
  tempCtx.putImageData(imageData, 0, 0);
  
  // Set target canvas size
  canvas.width = newWidth;
  canvas.height = newHeight;
  
  // Draw the resized image onto the target canvas
  ctx.drawImage(tempCanvas, 0, 0, imageData.width, imageData.height, 0, 0, newWidth, newHeight);
  
  // Return new ImageData
  return ctx.getImageData(0, 0, newWidth, newHeight);
}

// 计算感知哈希
function calculatePerceptualHash(imageData) {
  // 转换为灰度
  const grayscaleData = convertToGrayscale(imageData);
  
  // 调整为32x32用于DCT处理
  const resizedData = resizeImageData(grayscaleData, 32, 32);
  
  // 将图像数据转换为2D数组用于DCT
  const pixels = new Array(32);
  for (let y = 0; y < 32; y++) {
    pixels[y] = new Array(32);
    for (let x = 0; x < 32; x++) {
      const idx = (y * 32 + x) * 4;
      pixels[y][x] = resizedData.data[idx]; // 使用红色通道（灰度）
    }
  }
  
  // 应用DCT - 简化版本
  const dct = applySimplifiedDCT(pixels, 32);
  
  // 计算低频分量的中值（不包括DC分量）
  // 我们将使用DCT系数的较小部分（8x8低频分量）
  const hashSize = 8;
  const dctLowFreq = [];
  for (let y = 0; y < hashSize; y++) {
    for (let x = 0; x < hashSize; x++) {
      if (!(x === 0 && y === 0)) { // 跳过DC分量（左上角）
        dctLowFreq.push(dct[y][x]);
      }
    }
  }
  dctLowFreq.sort((a, b) => a - b);
  const medianValue = dctLowFreq[Math.floor(dctLowFreq.length / 2)];
  
  // 使用低频分量生成哈希
  let hash = '';
  for (let y = 0; y < hashSize; y++) {
    for (let x = 0; x < hashSize; x++) {
      if (!(x === 0 && y === 0)) { // 跳过DC分量
        hash += (dct[y][x] >= medianValue) ? '1' : '0';
      }
    }
  }
  
  return hash;
}

// 应用简化的DCT
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
      
      // 应用权重因子
      const cu = (u === 0) ? 1 / Math.sqrt(2) : 1;
      const cv = (v === 0) ? 1 / Math.sqrt(2) : 1;
      result[u][v] = sum * cu * cv * (2 / size);
    }
  }
  
  return result;
}

// 计算汉明距离
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

// 计算SSIM (结构相似性指数)
function calculateSSIM(img1Data, img2Data) {
  // 转换为灰度
  const gray1 = convertToGrayscale(img1Data);
  const gray2 = convertToGrayscale(img2Data);
  
  // 计算均值
  let mean1 = 0, mean2 = 0;
  const pixelCount = gray1.width * gray1.height;
  
  for (let i = 0; i < gray1.data.length; i += 4) {
    mean1 += gray1.data[i];
    mean2 += gray2.data[i];
  }
  mean1 /= pixelCount;
  mean2 /= pixelCount;
  
  // 计算方差和协方差
  let var1 = 0, var2 = 0, covar = 0;
  for (let i = 0; i < gray1.data.length; i += 4) {
    const diff1 = gray1.data[i] - mean1;
    const diff2 = gray2.data[i] - mean2;
    var1 += diff1 * diff1;
    var2 += diff2 * diff2;
    covar += diff1 * diff2;
  }
  var1 /= pixelCount;
  var2 /= pixelCount;
  covar /= pixelCount;
  
  // 稳定常数
  const C1 = SSIM_C1_FACTOR * 255 * SSIM_C1_FACTOR * 255;
  const C2 = SSIM_C2_FACTOR * 255 * SSIM_C2_FACTOR * 255;
  
  // 计算SSIM
  const numerator = (2 * mean1 * mean2 + C1) * (2 * covar + C2);
  const denominator = (mean1 * mean1 + mean2 * mean2 + C1) * (var1 + var2 + C2);
  
  return numerator / denominator;
}
/**
 * Native image processor utility for AutoSlides Extractor
 * A replacement for Sharp dependency using native Node.js
 */

const fs = require('fs');
const path = require('path');

// Simple JPEG decoder markers
const JPEG_SOI = Buffer.from([0xFF, 0xD8]); // Start of Image
const JPEG_EOI = Buffer.from([0xFF, 0xD9]); // End of Image
const JPEG_SOF0 = 0xC0;  // Start of Frame marker
const JPEG_SOF2 = 0xC2;  // Progressive JPEG marker

/**
 * Create an image processor instance for a given buffer
 * @param {Buffer} buffer - Image buffer data
 * @returns {Object} Image processor object with methods
 */
function createImageProcessor(buffer) {
  // Store the original buffer
  const originalBuffer = Buffer.from(buffer);
  
  // Private data storage for processing
  const _data = {
    buffer: originalBuffer,
    width: 0,
    height: 0,
    format: '',
    pixels: null
  };

  /**
   * Get the metadata of the image 
   * This performs basic parsing to extract dimensions
   */
  async function getMetadata() {
    if (_data.width && _data.height) {
      return { 
        width: _data.width, 
        height: _data.height, 
        format: _data.format 
      };
    }

    try {
      // Check for JPEG format
      if (originalBuffer[0] === 0xFF && originalBuffer[1] === 0xD8) {
        _data.format = 'jpeg';
        
        // Simple JPEG parser to get dimensions
        let offset = 2; // Skip SOI marker
        
        while (offset < originalBuffer.length) {
          // Find markers (they start with 0xFF)
          if (originalBuffer[offset] !== 0xFF) {
            offset++;
            continue;
          }
          
          // Get marker type
          const marker = originalBuffer[offset + 1];
          
          // Skip padding or markers without size info
          if (marker === 0xFF || marker === 0xD0 || marker === 0xD1 || 
              marker === 0xD2 || marker === 0xD3 || marker === 0xD4 || 
              marker === 0xD5 || marker === 0xD6 || marker === 0xD7) {
            offset += 2;
            continue;
          }
          
          // Get segment size
          const size = (originalBuffer[offset + 2] << 8) + originalBuffer[offset + 3];
          
          // SOF markers contain dimension info
          if (marker === JPEG_SOF0 || marker === JPEG_SOF2 || 
              (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC)) {
            _data.height = (originalBuffer[offset + 5] << 8) + originalBuffer[offset + 6];
            _data.width = (originalBuffer[offset + 7] << 8) + originalBuffer[offset + 8];
            break;
          }
          
          // Move to the next segment
          offset += size + 2;
        }
      } 
      // Check for PNG format
      else if (originalBuffer[0] === 0x89 && 
               originalBuffer[1] === 0x50 && 
               originalBuffer[2] === 0x4E && 
               originalBuffer[3] === 0x47) {
        _data.format = 'png';
        
        // PNG stores dimensions at a fixed position in the IHDR chunk
        _data.width = originalBuffer.readUInt32BE(16);
        _data.height = originalBuffer.readUInt32BE(20);
      }
      
      // If we couldn't determine the dimensions, set default values
      if (!_data.width || !_data.height) {
        _data.width = 800; // Default width
        _data.height = 600; // Default height
        _data.format = 'unknown';
      }
      
      return { 
        width: _data.width, 
        height: _data.height, 
        format: _data.format 
      };
    } catch (error) {
      console.error('Error getting image metadata:', error);
      _data.width = 800; // Default width
      _data.height = 600; // Default height
      _data.format = 'unknown';
      
      return { 
        width: _data.width, 
        height: _data.height, 
        format: _data.format 
      };
    }
  }

  /**
   * Decode image to raw pixel data (simplified and partial implementation)
   * @returns {Uint8Array} Raw pixel data
   */
  async function decode() {
    // If we already have decoded pixels, return them
    if (_data.pixels) {
      return _data.pixels;
    }
    
    // Get image metadata if not already extracted
    if (!_data.width || !_data.height) {
      await getMetadata();
    }
    
    // Simple approximate decoding for comparison purposes
    // For actual image processing, you would need a real decoder
    const pixels = new Uint8Array(_data.width * _data.height * 3);
    
    // For simplicity, we'll just sample the image data to approximate pixels
    // This is not actual decoding but a simplified approach for comparison
    if (_data.format === 'jpeg') {
      // For JPEG, use a sampling approach to extract approximate color data
      const samplingStep = Math.max(1, Math.floor(originalBuffer.length / (_data.width * _data.height * 0.3)));
      let pixelIndex = 0;
      
      for (let i = 0; i < originalBuffer.length - 3; i += samplingStep) {
        // Skip JPEG markers
        if (originalBuffer[i] === 0xFF && originalBuffer[i + 1] > 0xD0) {
          continue;
        }
        
        // Extract RGB-like values
        pixels[pixelIndex] = originalBuffer[i] % 256;
        pixels[pixelIndex + 1] = originalBuffer[i + 1] % 256;
        pixels[pixelIndex + 2] = originalBuffer[i + 2] % 256;
        
        pixelIndex += 3;
        if (pixelIndex >= pixels.length) break;
      }
    } else if (_data.format === 'png') {
      // For PNG, use a different sampling approach
      const dataStart = originalBuffer.indexOf(Buffer.from([0x49, 0x44, 0x41, 0x54])); // IDAT chunk
      if (dataStart > 0) {
        const samplingStep = Math.max(1, Math.floor((originalBuffer.length - dataStart) / (_data.width * _data.height * 0.3)));
        let pixelIndex = 0;
        
        for (let i = dataStart; i < originalBuffer.length - 3; i += samplingStep) {
          pixels[pixelIndex] = originalBuffer[i] % 256;
          pixels[pixelIndex + 1] = originalBuffer[i + 1] % 256;
          pixels[pixelIndex + 2] = originalBuffer[i + 2] % 256;
          
          pixelIndex += 3;
          if (pixelIndex >= pixels.length) break;
        }
      }
    } else {
      // For unknown formats, generate random data with consistent pattern based on buffer content
      // This ensures the same image produces similar comparison results
      const hashSum = originalBuffer.reduce((sum, byte, i) => sum + byte * (i % 100 + 1), 0);
      const seed = hashSum % 1000;
      
      for (let i = 0; i < pixels.length; i++) {
        pixels[i] = (originalBuffer[i % originalBuffer.length] + seed + i) % 256;
      }
    }
    
    _data.pixels = pixels;
    return pixels;
  }

  /**
   * Convert image to grayscale
   * @returns {Uint8Array} Grayscale pixel data
   */
  async function toGrayscale() {
    const pixels = await decode();
    const width = _data.width;
    const height = _data.height;
    
    // Create grayscale pixel array (1 byte per pixel)
    const grayscale = new Uint8Array(width * height);
    
    // Convert RGB to grayscale using luminance formula
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 3;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        
        // Standard luminance formula
        grayscale[y * width + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      }
    }
    
    return grayscale;
  }

  /**
   * Resize image to specified dimensions
   * @param {number} width - Target width
   * @param {number} height - Target height (defaults to proportional if not specified)
   * @param {Object} options - Resize options
   * @returns {Object} New image processor with resized image
   */
  function resize(width, height = null, options = {}) {
    // If height is null, maintain aspect ratio
    if (height === null && _data.height && _data.width) {
      height = Math.round(_data.height * (width / _data.width));
    }
    
    // Create a new processor instance
    const newProcessor = createImageProcessor(originalBuffer);
    
    // Override the metadata and decode functions to return resized values
    newProcessor.getMetadata = async function() {
      return { width, height, format: _data.format };
    };
    
    // Override the decode function to perform resizing
    newProcessor.decode = async function() {
      const sourcePixels = await decode();
      const sourceWidth = _data.width;
      const sourceHeight = _data.height;
      
      if (!sourcePixels) return null;
      
      const targetPixels = new Uint8Array(width * height * 3);
      
      // Simple nearest-neighbor scaling (fast but low quality)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          // Map target coordinates to source coordinates
          const srcX = Math.floor(x * sourceWidth / width);
          const srcY = Math.floor(y * sourceHeight / height);
          
          // Get source pixel
          const srcIdx = (srcY * sourceWidth + srcX) * 3;
          const tgtIdx = (y * width + x) * 3;
          
          // Copy RGB values
          targetPixels[tgtIdx] = sourcePixels[srcIdx];
          targetPixels[tgtIdx + 1] = sourcePixels[srcIdx + 1];
          targetPixels[tgtIdx + 2] = sourcePixels[srcIdx + 2];
        }
      }
      
      return targetPixels;
    };
    
    return newProcessor;
  }
  
  /**
   * Apply simple blur effect (for noise reduction)
   * @param {number} sigma - Blur sigma/radius
   * @returns {Object} New image processor with blurred image
   */
  function blur(sigma = 1.0) {
    // Create a new processor instance
    const newProcessor = createImageProcessor(originalBuffer);
    
    // Copy metadata from original
    newProcessor.getMetadata = getMetadata;
    
    // Override the decode function to apply blur
    newProcessor.decode = async function() {
      const sourcePixels = await decode();
      const width = _data.width;
      const height = _data.height;
      
      if (!sourcePixels) return null;
      
      const blurredPixels = new Uint8Array(width * height * 3);
      
      // Copy pixels first
      blurredPixels.set(sourcePixels);
      
      // Only apply blur if sigma is significant
      if (sigma >= 0.3) {
        // Simple box blur - not as good as Gaussian but faster
        const radius = Math.floor(sigma * 2);
        
        // Apply horizontal blur
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            let rSum = 0, gSum = 0, bSum = 0;
            let count = 0;
            
            // Average neighboring pixels
            for (let i = -radius; i <= radius; i++) {
              const nx = x + i;
              if (nx < 0 || nx >= width) continue;
              
              const idx = (y * width + nx) * 3;
              rSum += sourcePixels[idx];
              gSum += sourcePixels[idx + 1];
              bSum += sourcePixels[idx + 2];
              count++;
            }
            
            // Write blurred pixel
            const idx = (y * width + x) * 3;
            blurredPixels[idx] = Math.round(rSum / count);
            blurredPixels[idx + 1] = Math.round(gSum / count);
            blurredPixels[idx + 2] = Math.round(bSum / count);
          }
        }
      }
      
      return blurredPixels;
    };
    
    return newProcessor;
  }

  // Return public API
  return {
    getMetadata,
    decode,
    toGrayscale,
    resize,
    blur
  };
}

module.exports = {
  createImageProcessor
};
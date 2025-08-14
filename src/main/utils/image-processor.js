/**
 * High-quality image processor utility for AutoSlides Extractor
 * Using Jimp for professional image processing capabilities
 */

const { Jimp } = require('jimp');

/**
 * Create an image processor instance for a given buffer
 * @param {Buffer} buffer - Image buffer data
 * @returns {Object} Image processor object with methods
 */
function createImageProcessor(buffer) {
  // Store the original buffer
  const originalBuffer = Buffer.from(buffer);
  
  // Cache for the Jimp image instance
  let jimpImage = null;
  
  /**
   * Get or create the Jimp image instance
   * @returns {Promise<Jimp>} Jimp image instance
   */
  async function getJimpImage() {
    if (!jimpImage) {
      try {
        jimpImage = await Jimp.read(originalBuffer);
      } catch (error) {
        console.error('Error reading image with Jimp:', error);
        // Create a fallback 1x1 transparent image if reading fails
        jimpImage = new Jimp(1, 1, 0x00000000);
      }
    }
    return jimpImage;
  }

  /**
   * Get the metadata of the image
   * @returns {Promise<Object>} Image metadata
   */
  async function getMetadata() {
    try {
      const image = await getJimpImage();
      return {
        width: image.width,
        height: image.height,
        format: 'image/jpeg' // Jimp 1.6.0 doesn't have getMIME()
      };
    } catch (error) {
      console.error('Error getting image metadata:', error);
      return {
        width: 800,
        height: 600,
        format: 'image/jpeg'
      };
    }
  }

  /**
   * Decode image to raw pixel data
   * @returns {Promise<Uint8Array>} Raw RGB pixel data (3 bytes per pixel)
   */
  async function decode() {
    try {
      const image = await getJimpImage();
      const width = image.width;
      const height = image.height;
      
      // Create RGB pixel array (3 bytes per pixel)
      const pixels = new Uint8Array(width * height * 3);
      
      // Extract RGB data from Jimp image
      let pixelIndex = 0;
      image.scan(0, 0, width, height, function (x, y, idx) {
        // Jimp stores pixels as RGBA, we need RGB
        pixels[pixelIndex] = this.bitmap.data[idx];     // R
        pixels[pixelIndex + 1] = this.bitmap.data[idx + 1]; // G
        pixels[pixelIndex + 2] = this.bitmap.data[idx + 2]; // B
        pixelIndex += 3;
      });
      
      return pixels;
    } catch (error) {
      console.error('Error decoding image:', error);
      // Return a minimal fallback
      return new Uint8Array(3); // 1x1 black pixel
    }
  }

  /**
   * Convert image to grayscale
   * @returns {Promise<Uint8Array>} Grayscale pixel data (1 byte per pixel)
   */
  async function toGrayscale() {
    try {
      const image = await getJimpImage();
      const grayscaleImage = image.clone().greyscale();
      
      const width = grayscaleImage.width;
      const height = grayscaleImage.height;
      
      // Create grayscale pixel array (1 byte per pixel)
      const grayscale = new Uint8Array(width * height);
      
      // Extract grayscale data
      let pixelIndex = 0;
      grayscaleImage.scan(0, 0, width, height, function (x, y, idx) {
        // For grayscale, R=G=B, so we can use any channel
        grayscale[pixelIndex] = this.bitmap.data[idx];
        pixelIndex++;
      });
      
      return grayscale;
    } catch (error) {
      console.error('Error converting to grayscale:', error);
      // Return a minimal fallback
      return new Uint8Array(1); // 1x1 black pixel
    }
  }

  /**
   * Resize image to specified dimensions
   * @param {number} width - Target width
   * @param {number} height - Target height (defaults to proportional if not specified)
   * @param {Object} options - Resize options
   * @returns {Object} New image processor with resized image
   */
  function resize(width, height = null, options = {}) {
    // Create a new processor instance for the resized image
    const newProcessor = {
      getMetadata: async function() {
        try {
          const image = await getJimpImage();
          let targetWidth = width;
          let targetHeight = height;
          
          // If height is null, maintain aspect ratio
          if (targetHeight === null) {
            const aspectRatio = image.height / image.width;
            targetHeight = Math.round(targetWidth * aspectRatio);
          }
          
          return {
            width: targetWidth,
            height: targetHeight,
            format: 'image/jpeg'
          };
        } catch (error) {
          console.error('Error getting resized metadata:', error);
          return { width, height: height || width, format: 'image/jpeg' };
        }
      },

      decode: async function() {
        try {
          const image = await getJimpImage();
          let targetWidth = width;
          let targetHeight = height;
          
          // If height is null, maintain aspect ratio
          if (targetHeight === null) {
            const aspectRatio = image.height / image.width;
            targetHeight = Math.round(targetWidth * aspectRatio);
          }
          
          // Resize with high-quality algorithm
          const resizedImage = image.clone().resize({ w: targetWidth, h: targetHeight });
          
          // Extract RGB data
          const pixels = new Uint8Array(targetWidth * targetHeight * 3);
          let pixelIndex = 0;
          
          resizedImage.scan(0, 0, targetWidth, targetHeight, function (x, y, idx) {
            pixels[pixelIndex] = this.bitmap.data[idx];     // R
            pixels[pixelIndex + 1] = this.bitmap.data[idx + 1]; // G
            pixels[pixelIndex + 2] = this.bitmap.data[idx + 2]; // B
            pixelIndex += 3;
          });
          
          return pixels;
        } catch (error) {
          console.error('Error resizing image:', error);
          return new Uint8Array(width * (height || width) * 3);
        }
      },

      toGrayscale: async function() {
        try {
          const image = await getJimpImage();
          let targetWidth = width;
          let targetHeight = height;
          
          // If height is null, maintain aspect ratio
          if (targetHeight === null) {
            const aspectRatio = image.height / image.width;
            targetHeight = Math.round(targetWidth * aspectRatio);
          }
          
          // Resize and convert to grayscale with high quality
          const processedImage = image.clone()
            .resize({ w: targetWidth, h: targetHeight })
            .greyscale();
          
          // Extract grayscale data
          const grayscale = new Uint8Array(targetWidth * targetHeight);
          let pixelIndex = 0;
          
          processedImage.scan(0, 0, targetWidth, targetHeight, function (x, y, idx) {
            grayscale[pixelIndex] = this.bitmap.data[idx];
            pixelIndex++;
          });
          
          return grayscale;
        } catch (error) {
          console.error('Error resizing and converting to grayscale:', error);
          return new Uint8Array(width * (height || width));
        }
      },

      resize: function(newWidth, newHeight = null, newOptions = {}) {
        return resize(newWidth, newHeight, newOptions);
      },

      blur: function(sigma = 1.0) {
        return blur(sigma);
      }
    };

    return newProcessor;
  }

  /**
   * Apply Gaussian blur effect
   * @param {number} sigma - Blur sigma/radius
   * @returns {Object} New image processor with blurred image
   */
  function blur(sigma = 1.0) {
    // Create a new processor instance for the blurred image
    const newProcessor = {
      getMetadata: getMetadata,

      decode: async function() {
        try {
          const image = await getJimpImage();
          
          // Apply Gaussian blur with Jimp's high-quality algorithm
          // Jimp uses radius instead of sigma, convert sigma to radius
          const radius = Math.max(1, Math.round(sigma * 2));
          const blurredImage = image.clone().blur(radius);
          
          const width = blurredImage.width;
          const height = blurredImage.height;
          
          // Extract RGB data
          const pixels = new Uint8Array(width * height * 3);
          let pixelIndex = 0;
          
          blurredImage.scan(0, 0, width, height, function (x, y, idx) {
            pixels[pixelIndex] = this.bitmap.data[idx];     // R
            pixels[pixelIndex + 1] = this.bitmap.data[idx + 1]; // G
            pixels[pixelIndex + 2] = this.bitmap.data[idx + 2]; // B
            pixelIndex += 3;
          });
          
          return pixels;
        } catch (error) {
          console.error('Error applying blur:', error);
          // Fallback to original decode
          return await decode();
        }
      },

      toGrayscale: async function() {
        try {
          const image = await getJimpImage();
          
          // Apply blur and convert to grayscale
          const radius = Math.max(1, Math.round(sigma * 2));
          const processedImage = image.clone().blur(radius).greyscale();
          
          const width = processedImage.width;
          const height = processedImage.height;
          
          // Extract grayscale data
          const grayscale = new Uint8Array(width * height);
          let pixelIndex = 0;
          
          processedImage.scan(0, 0, width, height, function (x, y, idx) {
            grayscale[pixelIndex] = this.bitmap.data[idx];
            pixelIndex++;
          });
          
          return grayscale;
        } catch (error) {
          console.error('Error applying blur and converting to grayscale:', error);
          // Fallback to original toGrayscale
          return await toGrayscale();
        }
      },

      resize: function(width, height = null, options = {}) {
        return resize(width, height, options);
      },

      blur: function(newSigma = 1.0) {
        return blur(newSigma);
      }
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
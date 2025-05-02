const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const sharp = require('sharp');
const os = require('os');
const { Worker } = require('worker_threads');

// Debug mode flag - set to false to disable verbose logging
const DEBUG_MODE = false;

// Threshold parameter settings for image comparisons
const HAMMING_THRESHOLD_UP = 5;       // Perception Hash Hamming Distance Upper Threshold
const SSIM_THRESHOLD = 0.999;         // Structure Similarity Index Threshold
const PIXEL_CHANGE_RATIO_THRESHOLD = 0.005;  // Base comparison method's change rate threshold
const PIXEL_DIFF_THRESHOLD = 30;      // Pixel difference threshold
const SSIM_C1_FACTOR = 0.01;          // C1 factor in SSIM calculation
const SSIM_C2_FACTOR = 0.03;          // C2 factor in SSIM calculation
const VERIFICATION_COUNT = 2;         // The number of consecutive identical frames required for secondary verification
const SIZE_IDENTICAL_THRESHOLD = 0.0005; // 0.05% file size difference threshold for identical images
const SIZE_DIFF_THRESHOLD = 0.05;     // 5% file size difference threshold for different images

// Multi-core processing settings
const MAX_WORKERS = Math.max(1, os.cpus().length - 1); // Leave one core free for the main thread
const ENABLE_MULTI_CORE = true;       // Set to false to use only a single core

// Custom ffmpeg paths loader that won't break Windows builds
let ffmpegStatic, ffprobeStatic;

// Only try to load the modules in development mode
if (!app.isPackaged) {
  try {
    ffmpegStatic = require('ffmpeg-static');
    ffprobeStatic = require('ffprobe-static');
  } catch (error) {
    console.error('Failed to load ffmpeg modules:', error);
    ffmpegStatic = null;
    ffprobeStatic = null;
  }
}

app.setName('AutoSlides Extractor'); 

let ffmpegPath, ffprobePath;

if (app.isPackaged) {
  // In production: use binaries from resources folder based on architecture
  if (process.platform === 'win32') {
    // Now we only include one architecture in each build, so simplify the path
    ffmpegPath = path.join(process.resourcesPath, 'bin', 'ffmpeg.exe');
    ffprobePath = path.join(process.resourcesPath, 'bin', 'ffprobe.exe');
  } else {
    // For macOS - use the unpacked node_modules binaries
    ffmpegPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg');
    ffprobePath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'ffprobe-static', 'bin', 'darwin', process.arch === 'arm64' ? 'arm64' : 'x64', 'ffprobe');
  }
} else {
  // In development: use the npm packages
  ffmpegPath = ffmpegStatic;
  ffprobePath = ffprobeStatic?.path;
}

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

let mainWindow;

// Add this global variable to track the current ffmpeg command
let activeFFmpegCommand = null;

// Create configuration file path
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json');

// Default Configuration
const defaultConfig = {
  outputDir: path.join(app.getPath('downloads'), 'extracted'),
  checkInterval: 2,
  captureStrategy: {
    gaussianBlurSigma: 0.5,
    pixelDiffThreshold: 30,
    changeRatioThreshold: 0.005,
    hammingThresholdLow: 0,
    hammingThresholdUp: 5,
    ssimThreshold: 0.999
  },
  comparisonMethod: 'default',
  enableDoubleVerification: true,
  verificationCount: 2
};

// Ensure the directory exists
function ensureDirectoryExists(directory) {
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

// Load configuration
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      return { ...defaultConfig, ...JSON.parse(configData) };
    }
  } catch (error) {
    console.error('Failed to load configuration file:', error);
  }
  return defaultConfig;
}

// Save Configuration
function saveConfig(config) {
  try {
    const configData = JSON.stringify({ ...loadConfig(), ...config }, null, 2);
    fs.writeFileSync(configPath, configData, 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to save configuration file:', error);
    return false;
  }
}

function createWindow() {
  // Create browser window
  mainWindow = new BrowserWindow({
    width: 560,
    height: 820,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  });

  // Load the application's index.html
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Triggered when the window is closed
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// This method is called when Electron has finished initializing and is ready to create browser windows.
app.whenReady().then(() => {
  const config = loadConfig();
  
  createWindow();
  ensureDirectoryExists(config.outputDir);

  app.on('activate', function () {
    // On macOS, when clicking the dock icon and no other windows are open, it usually recreates a window in the application.
    if (mainWindow === null) createWindow();
  });
});

// Exit the application when all windows are closed
app.on('window-all-closed', function () {
  // On macOS, unless the user explicitly quits using Cmd + Q, the application and menu bar will remain active.
  if (process.platform !== 'darwin') app.quit();
});

// Handle IPC messages

// Get Configuration
ipcMain.handle('get-config', () => {
  return loadConfig();
});

// Save Configuration
ipcMain.handle('save-config', (event, config) => {
  return saveConfig(config);
});

// Select Output Directory
ipcMain.handle('select-output-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    const config = loadConfig();
    config.outputDir = result.filePaths[0];
    saveConfig(config);
    return result.filePaths[0];
  }
  return null;
});

// Select video file
ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'avi', 'mkv', 'mov', 'webm'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    // Store the selected video path in a global variable for use by createSlidesDir
    global.selectedVideoPath = result.filePaths[0];
    return result.filePaths[0];
  }
  return null;
});

// Get video information
ipcMain.handle('get-video-info', async (event, videoPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err.message);
        return;
      }
      
      // Extract video information
      const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
      if (!videoStream) {
        reject('No video stream found');
        return;
      }
      
      resolve({
        duration: metadata.format.duration,
        width: videoStream.width,
        height: videoStream.height,
        fps: eval(videoStream.r_frame_rate),
        codec: videoStream.codec_name
      });
    });
  });
});

// Process video frame extraction
ipcMain.handle('extract-frames', async (event, { videoPath, outputDir, interval, saveFrames = false, onProgress }) => {
  // Update global variable, ensuring createSlidesDir can access the current video path
  global.selectedVideoPath = videoPath;
  return new Promise((resolve, reject) => {
    try {
      // Ensure output directory exists
      ensureDirectoryExists(outputDir);
      
      // Get video info
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(err.message);
          return;
        }
        
        const duration = metadata.format.duration;
        const totalFrames = Math.floor(duration / interval);
        let processedFrames = 0;
        
        // Create timestamp directory
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const framesDir = path.join(outputDir, `frames_${timestamp}`);
        
        // Only create directory if frames need to be saved
        if (saveFrames && !fs.existsSync(framesDir)) {
          fs.mkdirSync(framesDir, { recursive: true });
        }
        
        // Create temporary directory for processing
        const tempDir = path.join(app.getPath('temp'), `frames_temp_${timestamp}`);
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        // Set up frame extraction command
        const command = ffmpeg(videoPath)
          .outputOptions([
            `-vf fps=1/${interval}`,  // Extract one frame every interval seconds
            `-threads 0`,             // Use all available threads
            `-preset ultrafast`,      // Use ultrafast preset for faster processing
            '-q:v 1'                  // Highest quality
          ])
          .output(path.join(saveFrames ? framesDir : tempDir, 'frame-%04d.jpg'))
          .on('progress', (progress) => {
            // Calculate progress
            const currentTime = progress.timemark.split(':');
            const seconds = parseInt(currentTime[0]) * 3600 + 
                          parseInt(currentTime[1]) * 60 + 
                          parseFloat(currentTime[2]);
            const percent = Math.min(100, Math.round((seconds / duration) * 100));
            
            // Notify renderer process of progress update
            event.sender.send('extraction-progress', { percent, currentTime: seconds, totalTime: duration });
          })
          .on('end', () => {
            activeFFmpegCommand = null; // Clear the reference when done
            resolve({
              framesDir: saveFrames ? framesDir : tempDir,
              totalFrames: Math.floor(duration / interval),
              tempDir: !saveFrames ? tempDir : null // Return temp directory path for later cleanup
            });
          })
          .on('error', (err) => {
            activeFFmpegCommand = null; // Clear the reference on error
            reject(`Frame extraction error: ${err.message}`);
          });
        
        // Store the command reference so we can kill it if needed
        activeFFmpegCommand = command;
        
        // Execute command
        command.run();
      });
    } catch (error) {
      reject(`Video processing error: ${error.message}`);
    }
  });
});

// Add a new IPC handler to cancel the ffmpeg process
ipcMain.handle('cancel-extraction', () => {
  return new Promise((resolve) => {
    if (activeFFmpegCommand) {
      // Kill the ffmpeg process
      activeFFmpegCommand.kill('SIGKILL');
      activeFFmpegCommand = null;
      resolve({ success: true });
    } else {
      resolve({ success: false, message: 'No active ffmpeg process to cancel' });
    }
  });
});

// Save Slides
ipcMain.handle('save-slide', async (event, { imageData, outputDir, filename }) => {
  return new Promise((resolve, reject) => {
    try {
      // Ensure the output directory exists
      ensureDirectoryExists(outputDir);
      
      // Write Base64 image data to a file
      const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const filePath = path.join(outputDir, filename);
      
      fs.writeFile(filePath, buffer, (err) => {
        if (err) {
          reject(`Failed to save image: ${err.message}`);
        } else {
          resolve({ success: true, filePath });
        }
      });
    } catch (error) {
      reject(`Image saving error: ${error.message}`);
    }
  });
});

// List frame files
ipcMain.handle('list-frame-files', async (event, dirPath) => {
  return new Promise((resolve, reject) => {
    try {
      // Ensure the directory exists
      if (!fs.existsSync(dirPath)) {
        reject('Directory does not exist');
        return;
      }
      
      // Read files in the directory
      const files = fs.readdirSync(dirPath)
        .filter(file => file.endsWith('.jpg'))
        .sort((a, b) => {
          // Sort by frame number
          const numA = parseInt(a.match(/frame-(\d+)/)[1]);
          const numB = parseInt(b.match(/frame-(\d+)/)[1]);
          return numA - numB;
        })
        .map(file => ({
          name: file,
          fullPath: path.join(dirPath, file)
        }));
      
      resolve({ files });
    } catch (error) {
      reject(`Error listing frame files: ${error.message}`);
    }
  });
});

// Read frame image
ipcMain.handle('read-frame-image', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    try {
      // Ensure the file exists
      if (!fs.existsSync(filePath)) {
        reject('File does not exist');
        return;
      }
      
      // Read file
      const frameData = fs.readFileSync(filePath);
      const base64Data = `data:image/jpeg;base64,${frameData.toString('base64')}`;
      
      resolve(base64Data);
    } catch (error) {
      reject(`Error reading frame image: ${error.message}`);
    }
  });
});

// Create Slide Directory
ipcMain.handle('create-slides-dir', async (event, baseDir) => {
  return new Promise((resolve, reject) => {
    try {
      // Get the currently selected video path
      const videoPath = global.selectedVideoPath;
      let folderName = 'slides_';
      
      // If there is a video path, use the video file name (replace spaces with underscores).
      if (videoPath) {
        // Extract file name (without extension)
        const videoFileName = path.basename(videoPath, path.extname(videoPath));
        // Replace spaces with underscores
        folderName = videoFileName.replace(/\s+/g, '_');
      } else {
        // If there is no video path, use the timestamp as an alternative.
        folderName = 'slides_' + new Date().toISOString().replace(/[:.]/g, '-');
      }
      
      // Create slide output directory
      const slidesDir = path.join(baseDir, folderName);
      if (!fs.existsSync(slidesDir)) {
        fs.mkdirSync(slidesDir, { recursive: true });
      }
      
      resolve(slidesDir);
    } catch (error) {
      reject(`Error creating slides directory: ${error.message}`);
    }
  });
});

// Clean up temporary directory
ipcMain.handle('cleanup-temp-dir', async (event, tempDir) => {
  return new Promise((resolve, reject) => {
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        // Delete all files in the temporary directory
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
          fs.unlinkSync(path.join(tempDir, file));
        }
        
        // Delete temporary directory
        fs.rmdirSync(tempDir);
        resolve({ success: true });
      } else {
        resolve({ success: false, message: 'Temporary directory does not exist' });
      }
    } catch (error) {
      console.error('Failed to cleanup temporary directory:', error);
      // Even if the cleanup fails, do not throw an exception to avoid affecting the user experience.
      resolve({ success: false, message: error.message });
    }
  });
});

// ===== New Image Processing Functions for Main Process =====

// Analyze frames for slide extraction
ipcMain.handle('analyze-frames', async (event, { 
  framesDir, 
  outputDir, 
  comparisonMethod, 
  enableDoubleVerification 
}) => {
  try {
    // Get all frame files
    const result = await listFrameFiles(framesDir);
    const frameFiles = result.files;
    
    // Create slide output directory
    const slidesDir = await createSlidesDir(outputDir);
    
    // Process frames
    const extractedSlides = await processFrames(event, frameFiles, slidesDir, {
      comparisonMethod,
      enableDoubleVerification
    });
    
    return { 
      success: true, 
      extractedCount: extractedSlides.length, 
      slides: extractedSlides
    };
  } catch (error) {
    console.error('Failed to analyze frames:', error);
    return { success: false, error: error.message };
  }
});

// Process frames to detect slides with multi-core support
async function processFrames(event, frameFiles, slidesDir, options) {
  // If multi-core is disabled, use the original single-core method
  if (!ENABLE_MULTI_CORE) {
    return await processFramesSingleCore(event, frameFiles, slidesDir, options);
  }
  
  const { comparisonMethod, enableDoubleVerification } = options;
  
  // Track progress
  let processedFrames = 0;
  const totalFrames = frameFiles.length;
  
  try {
    // Calculate optimal chunk size based on available cores
    const workerCount = Math.min(MAX_WORKERS, Math.ceil(totalFrames / 100));
    const chunkSize = Math.ceil(totalFrames / workerCount);
    
    if (DEBUG_MODE) {
      console.log(`Using ${workerCount} workers with chunk size of ${chunkSize} frames`);
    }
    
    // Create workers
    const workers = [];
    const tasks = [];
    
    // Create and initialize workers
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(path.join(__dirname, 'workers', 'image-processor.js'), {
        workerData: {
          constants: {
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
          }
        }
      });
      
      workers.push(worker);
      
      // Wait for worker to be ready
      await new Promise((resolve) => {
        worker.once('message', (message) => {
          if (message.type === 'ready') {
            resolve();
          }
        });
      });
    }
    
    // Divide frames into chunks
    const chunks = [];
    for (let i = 0; i < workerCount; i++) {
      const startIndex = i * chunkSize;
      const endIndex = Math.min(startIndex + chunkSize, frameFiles.length);
      chunks.push(frameFiles.slice(startIndex, endIndex));
    }
    
    // Process each chunk with its worker
    for (let i = 0; i < workerCount; i++) {
      const worker = workers[i];
      const chunk = chunks[i];
      const startIndex = i * chunkSize;
      
      // If this isn't the first chunk, we need to provide the last frame from the previous chunk
      let previousChunkLastFrame = null;
      if (i > 0 && chunks[i-1].length > 0) {
        const lastFrameOfPreviousChunk = chunks[i-1][chunks[i-1].length - 1].fullPath;
        previousChunkLastFrame = await fs.promises.readFile(lastFrameOfPreviousChunk);
      }
      
      // Create a promise that resolves when this worker completes
      const task = new Promise((resolve, reject) => {
        worker.on('message', async (message) => {
          if (message.type === 'result') {
            // Update progress
            processedFrames += chunk.length;
            const percent = Math.round((processedFrames / totalFrames) * 100);
            event.sender.send('analysis-progress', { 
              percent, 
              processedFrames, 
              totalFrames,
              workerId: i
            });
            
            resolve(message.result);
          } else if (message.type === 'error') {
            reject(new Error(`Worker ${i} error: ${message.error}`));
          }
        });
        
        worker.on('error', (err) => {
          reject(new Error(`Worker ${i} error: ${err.message}`));
        });
        
        // Start processing
        worker.postMessage({
          type: 'process',
          frames: chunk,
          options: {
            comparisonMethod,
            enableDoubleVerification,
            startIndex
          },
          previousChunkLastFrame
        });
      });
      
      tasks.push(task);
    }
    
    // Wait for all workers to complete
    const results = await Promise.all(tasks);
    
    // Close all workers
    for (const worker of workers) {
      worker.terminate();
    }
    
    // Merge results and handle edge cases
    return await mergeWorkerResults(event, results, slidesDir, enableDoubleVerification);
    
  } catch (error) {
    console.error('Error processing frames with multiple cores:', error);
    throw error;
  }
}

// Original single-core method (renamed)
async function processFramesSingleCore(event, frameFiles, slidesDir, options) {
  const { comparisonMethod, enableDoubleVerification } = options;
  
  // Track progress
  let processedFrames = 0;
  const totalFrames = frameFiles.length;
  
  // Track extracted slides
  let extractedSlides = [];
  
  // Store the last image buffer for comparison
  let lastImageBuffer = null;
  let potentialNewImageBuffer = null;
  let currentVerification = 0;
  
  try {
    for (let i = 0; i < frameFiles.length; i++) {
      const frameFile = frameFiles[i];
      const framePath = frameFile.fullPath;
      
      // Update progress (every 5 frames to reduce IPC overhead)
      processedFrames++;
      if (processedFrames % 5 === 0 || processedFrames === totalFrames) {
        const percent = Math.round((processedFrames / totalFrames) * 100);
        event.sender.send('analysis-progress', { 
          percent, 
          processedFrames, 
          totalFrames 
        });
      }

      // Load the current frame
      const currentImageBuffer = await fs.promises.readFile(framePath);
      
      // Save the first frame directly
      if (lastImageBuffer === null) {
        lastImageBuffer = currentImageBuffer;
        const slideNumber = String(extractedSlides.length + 1).padStart(3, '0');
        const slideFilename = `slide-${slideNumber}.jpg`;
        const slidePath = path.join(slidesDir, slideFilename);
        
        await fs.promises.writeFile(slidePath, currentImageBuffer);
        
        extractedSlides.push({
          index: extractedSlides.length,
          path: slidePath,
          filename: slideFilename
        });
        
        // Notify about the extracted slide
        event.sender.send('slide-extracted', {
          slideNumber: extractedSlides.length,
          slidePath,
          slideFilename
        });
        
        continue;
      }
      
      // Compare the current frame with the previous frame
      const comparisonResult = await compareImages(lastImageBuffer, currentImageBuffer, comparisonMethod);
      
      // If a change is detected
      if (comparisonResult.changed) {
        if (DEBUG_MODE) {
          console.log(`Change detected: ${comparisonResult.method}, Rate of change: ${comparisonResult.changeRatio.toFixed(4)}`);
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
                const slideNumber = String(extractedSlides.length + 1).padStart(3, '0');
                const slideFilename = `slide-${slideNumber}.jpg`;
                const slidePath = path.join(slidesDir, slideFilename);
                
                await fs.promises.writeFile(slidePath, lastImageBuffer);
                
                extractedSlides.push({
                  index: extractedSlides.length,
                  path: slidePath,
                  filename: slideFilename
                });
                
                // Notify about the extracted slide
                event.sender.send('slide-extracted', {
                  slideNumber: extractedSlides.length,
                  slidePath,
                  slideFilename
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
          
          const slideNumber = String(extractedSlides.length + 1).padStart(3, '0');
          const slideFilename = `slide-${slideNumber}.jpg`;
          const slidePath = path.join(slidesDir, slideFilename);
          
          await fs.promises.writeFile(slidePath, lastImageBuffer);
          
          extractedSlides.push({
            index: extractedSlides.length,
            path: slidePath,
            filename: slideFilename
          });
          
          // Notify about the extracted slide
          event.sender.send('slide-extracted', {
            slideNumber: extractedSlides.length,
            slidePath,
            slideFilename
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
            
            const slideNumber = String(extractedSlides.length + 1).padStart(3, '0');
            const slideFilename = `slide-${slideNumber}.jpg`;
            const slidePath = path.join(slidesDir, slideFilename);
            
            await fs.promises.writeFile(slidePath, lastImageBuffer);
            
            extractedSlides.push({
              index: extractedSlides.length,
              path: slidePath,
              filename: slideFilename
            });
            
            // Notify about the extracted slide
            event.sender.send('slide-extracted', {
              slideNumber: extractedSlides.length,
              slidePath,
              slideFilename
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
    
    return extractedSlides;
  } catch (error) {
    console.error('Error processing frames:', error);
    throw error;
  }
}

// Merge results from multiple workers
async function mergeWorkerResults(event, workerResults, slidesDir, enableDoubleVerification) {
  // Create a comprehensive list of all detected slides
  let extractedSlides = [];
  let slideIndex = 0;
  
  try {
    // First pass - process potential slides from each worker
    for (let i = 0; i < workerResults.length; i++) {
      const result = workerResults[i];
      const potentialSlides = result.potentialSlides || [];
      
      // Skip empty results
      if (potentialSlides.length === 0) {
        continue;
      }
      
      // Always save the first slide from the first worker
      if (i === 0) {
        const firstSlide = potentialSlides[0];
        slideIndex++;
        
        const slideNumber = String(slideIndex).padStart(3, '0');
        const slideFilename = `slide-${slideNumber}.jpg`;
        const slidePath = path.join(slidesDir, slideFilename);
        
        await fs.promises.writeFile(slidePath, firstSlide.buffer);
        
        extractedSlides.push({
          index: slideIndex - 1,
          path: slidePath,
          filename: slideFilename
        });
        
        // Notify about the extracted slide
        event.sender.send('slide-extracted', {
          slideNumber: slideIndex,
          slidePath,
          slideFilename
        });
        
        // Skip processing if this is the only slide
        if (potentialSlides.length === 1) {
          continue;
        }
      }
      
      // Process remaining slides
      for (let j = i === 0 ? 1 : 0; j < potentialSlides.length; j++) {
        const slide = potentialSlides[j];
        slideIndex++;
        
        const slideNumber = String(slideIndex).padStart(3, '0');
        const slideFilename = `slide-${slideNumber}.jpg`;
        const slidePath = path.join(slidesDir, slideFilename);
        
        await fs.promises.writeFile(slidePath, slide.buffer);
        
        extractedSlides.push({
          index: slideIndex - 1, 
          path: slidePath,
          filename: slideFilename
        });
        
        // Notify about the extracted slide
        event.sender.send('slide-extracted', {
          slideNumber: slideIndex,
          slidePath,
          slideFilename
        });
      }
    }
    
    // Second pass - check boundaries between workers for missed slides
    // Handle pending verification states that might be cut off at chunk boundaries
    if (enableDoubleVerification) {
      for (let i = 0; i < workerResults.length - 1; i++) {
        const currentResult = workerResults[i];
        const nextResult = workerResults[i + 1];
        
        // If the current chunk has a pending verification and the next chunk has a last frame
        if (currentResult.pendingVerification && nextResult.lastFrame) {
          const { buffer: potentialSlideBuffer, currentVerification } = currentResult.pendingVerification;
          
          // Compare with the first frame of next chunk
          const comparisonResult = await compareImages(potentialSlideBuffer, nextResult.lastFrame);
          
          // If they are similar, this is potentially a slide transition at chunk boundary
          if (!comparisonResult.changed && currentVerification >= VERIFICATION_COUNT - 1) {
            slideIndex++;
            
            const slideNumber = String(slideIndex).padStart(3, '0');
            const slideFilename = `slide-${slideNumber}.jpg`;
            const slidePath = path.join(slidesDir, slideFilename);
            
            await fs.promises.writeFile(slidePath, potentialSlideBuffer);
            
            extractedSlides.push({
              index: slideIndex - 1,
              path: slidePath,
              filename: slideFilename
            });
            
            // Notify about the extracted slide
            event.sender.send('slide-extracted', {
              slideNumber: slideIndex,
              slidePath,
              slideFilename
            });
          }
        }
      }
    }
    
    return extractedSlides;
  } catch (error) {
    console.error('Error merging worker results:', error);
    throw error;
  }
}

// Helper function to list frame files
async function listFrameFiles(dirPath) {
  try {
    // Ensure the directory exists
    if (!fs.existsSync(dirPath)) {
      throw new Error('Directory does not exist');
    }
    
    // Read files in the directory
    const files = fs.readdirSync(dirPath)
      .filter(file => file.endsWith('.jpg'))
      .sort((a, b) => {
        // Sort by frame number
        const numA = parseInt(a.match(/frame-(\d+)/)[1]);
        const numB = parseInt(b.match(/frame-(\d+)/)[1]);
        return numA - numB;
      })
      .map(file => ({
        name: file,
        fullPath: path.join(dirPath, file)
      }));
    
    return { files };
  } catch (error) {
    throw new Error(`Error listing frame files: ${error.message}`);
  }
}

// Helper function to create slides directory
async function createSlidesDir(baseDir) {
  try {
    // Get the currently selected video path
    const videoPath = global.selectedVideoPath;
    let folderName = 'slides_';
    
    // If there is a video path, use the video file name
    if (videoPath) {
      const videoFileName = path.basename(videoPath, path.extname(videoPath));
      folderName = videoFileName.replace(/\s+/g, '_');
    } else {
      folderName = 'slides_' + new Date().toISOString().replace(/[:.]/g, '-');
    }
    
    // Create slide output directory
    const slidesDir = path.join(baseDir, folderName);
    if (!fs.existsSync(slidesDir)) {
      fs.mkdirSync(slidesDir, { recursive: true });
    }
    
    return slidesDir;
  } catch (error) {
    throw new Error(`Error creating slides directory: ${error.message}`);
  }
}

// Compare two images using Sharp
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
    // Convert buffers to Sharp image objects
    const img1 = sharp(buffer1);
    const img2 = sharp(buffer2);
    
    // Get metadata for both images
    const metadata1 = await img1.metadata();
    const metadata2 = await img2.metadata();
    
    // Use different comparison strategies
    switch (method) {
      case 'basic':
        return await performBasicComparison(img1, img2, metadata1, metadata2);
      case 'default':
      default:
        return await performPerceptualComparison(img1, img2, metadata1, metadata2);
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

// Basic comparison using pixel difference
async function performBasicComparison(img1, img2, metadata1, metadata2) {
  try {
    // Ensure both images are the same size for comparison
    const width = Math.min(metadata1.width, metadata2.width);
    const height = Math.min(metadata1.height, metadata2.height);
    
    // Convert to grayscale and resize for comparison
    const gray1 = await img1
      .resize(width, height, { fit: 'fill' })
      .greyscale()
      .blur(0.5) // Apply light Gaussian blur for noise reduction
      .raw()
      .toBuffer();
      
    const gray2 = await img2
      .resize(width, height, { fit: 'fill' })
      .greyscale()
      .blur(0.5)
      .raw()
      .toBuffer();
    
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
async function performPerceptualComparison(img1, img2, metadata1, metadata2) {
  try {
    // Calculate perceptual hash
    const hash1 = await calculatePerceptualHash(img1);
    const hash2 = await calculatePerceptualHash(img2);
    
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
      const ssim = await calculateSSIM(img1, img2);
      
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
    return performBasicComparison(img1, img2, metadata1, metadata2);
  }
}

// Calculate perceptual hash
async function calculatePerceptualHash(img) {
  try {
    // Resize to 32x32 and convert to grayscale for DCT
    const { data, info } = await img
      .resize(32, 32, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
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
async function calculateSSIM(img1, img2) {
  try {
    // Resize images to the same dimensions
    const metadata1 = await img1.metadata();
    const width = metadata1.width;
    const height = metadata1.height;
    
    // Convert to grayscale for comparison
    const gray1 = await img1
      .resize(width, height)
      .greyscale()
      .raw()
      .toBuffer();
      
    const gray2 = await img2
      .resize(width, height)
      .greyscale()
      .raw()
      .toBuffer();
    
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


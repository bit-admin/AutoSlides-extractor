const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

// Set ffmpeg and ffprobe paths
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
    width: 530,
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

  // Open Developer Tools
  mainWindow.webContents.openDevTools();

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


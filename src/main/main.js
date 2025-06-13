const { app, BrowserWindow, ipcMain, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
// Remove Sharp dependency
const os = require('os');
const { Worker } = require('worker_threads');
const { createImageProcessor } = require('./utils/image-processor');

// Debug mode flag - set to false to disable verbose logging
const DEBUG_MODE = false;

// Threshold parameter settings for image comparisons
const HAMMING_THRESHOLD_UP = 5;       // Perception Hash Hamming Distance Upper Threshold
const SSIM_THRESHOLD = 0.999;         // Structure Similarity Index Threshold
const PIXEL_CHANGE_RATIO_THRESHOLD = 0.005;  // Base comparison method's change rate threshold
const PIXEL_DIFF_THRESHOLD = 30;      // Pixel difference threshold
const SSIM_C1_FACTOR = 0.01;          // C1 factor in SSIM calculation
const SSIM_C2_FACTOR = 0.03;          // C2 factor in SSIM calculation
const VERIFICATION_COUNT = 3;         // The number of consecutive identical frames required for secondary verification
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
  comparisonMethod: 'default',
  enableDoubleVerification: true,
  // Advanced threshold settings
  hammingThreshold: 5,
  ssimThreshold: 0.999,
  pixelChangeRatioThreshold: 0.005,
  verificationCount: 3,
  sizeIdenticalThreshold: 0.0005,
  sizeDiffThreshold: 0.05,
  enableMultiCore: true,
  // Video processing settings
  videoQuality: 1,                            // Video quality (1=highest, 31=lowest)
  // Post-processing settings
  enablePostProcessing: true,
  useSSIMFingerprint: true,                    // Use SSIM fingerprint by default
  ssimSimilarityThreshold: 0.95,              // Default SSIM similarity threshold
  fingerprintStorageDir: null,                // Will be set to userData/fingerprints
  excludeFingerprints: [
    // Example SSIM fingerprint exclude entry
  ]
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
      const loadedConfig = JSON.parse(configData);
      
      // Merge with defaults and ensure new SSIM fingerprint settings exist
      const mergedConfig = { ...defaultConfig, ...loadedConfig };
      
      // Ensure fingerprint storage directory is set
      if (!mergedConfig.fingerprintStorageDir) {
        mergedConfig.fingerprintStorageDir = fingerprintStorageDir;
      }
      
      // Ensure excludeFingerprints array exists
      if (!mergedConfig.excludeFingerprints) {
        mergedConfig.excludeFingerprints = [];
      }
      
      return mergedConfig;
    }
  } catch (error) {
    console.error('Failed to load configuration file:', error);
  }
  
  // Return default config with fingerprint storage directory set
  const configWithDefaults = { ...defaultConfig };
  configWithDefaults.fingerprintStorageDir = fingerprintStorageDir;
  return configWithDefaults;
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

// Get dynamic threshold values from config
function getThresholds() {
  const config = loadConfig();
  return {
    HAMMING_THRESHOLD_UP: config.hammingThreshold,
    SSIM_THRESHOLD: config.ssimThreshold,
    PIXEL_CHANGE_RATIO_THRESHOLD: config.pixelChangeRatioThreshold,
    VERIFICATION_COUNT: config.verificationCount,
    SIZE_IDENTICAL_THRESHOLD: config.sizeIdenticalThreshold,
    SIZE_DIFF_THRESHOLD: config.sizeDiffThreshold,
    ENABLE_MULTI_CORE: config.enableMultiCore
  };
}

function createWindow() {
  // Create browser window
  mainWindow = new BrowserWindow({
    width: 560,
    height: 820,
    minWidth: 560,
    minHeight: 820,
    maxWidth: 600,
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

function createApplicationMenu() {
  const template = [
    {
      label: app.getName(),
      submenu: [
        process.platform === 'darwin' 
          ? { role: 'about' } 
          : { 
              label: 'About', 
              click: () => {
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: 'About',
                  message: app.getName(),
                  detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.versions.node}`
                });
              }
            },
        { type: 'separator' },
        // macOS-specific items
        ...(process.platform === 'darwin' ? [
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideothers' },
          { role: 'unhide' },
          { type: 'separator' }
        ] : []),
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Visit GitHub Repository',
          click: async () => {
            await shell.openExternal('https://github.com/bit-admin/AutoSlides-extractor');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// This method is called when Electron has finished initializing and is ready to create browser windows.
app.whenReady().then(() => {
  const config = loadConfig();
  
  createWindow();
  createApplicationMenu();
  ensureDirectoryExists(config.outputDir);
  
  // Ensure fingerprint storage directory exists and initialize preset fingerprints
  ensureFingerprintStorageExists();
  
  // Sync with config after initialization is complete
  setTimeout(() => {
    syncFingerprintsWithConfig();
  }, 100);

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

// Select video file (supports multiple selection)
ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'avi', 'mkv', 'mov', 'webm'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    // Store the selected video path in a global variable for use by createSlidesDir
    global.selectedVideoPath = result.filePaths[0];
    return result.filePaths;
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
        const config = loadConfig();
        const videoQuality = config.videoQuality || 1;
        const enableMultiCore = config.enableMultiCore !== false;
        
        // Configure thread usage based on multi-core setting
        const threadCount = enableMultiCore ? 0 : 1; // 0 means use all available threads, 1 means single thread
        
        const command = ffmpeg(videoPath)
          .outputOptions([
            `-vf fps=1/${interval}`,  // Extract one frame every interval seconds
            `-threads ${threadCount}`, // Thread count based on multi-core setting
            `-preset ultrafast`,      // Use ultrafast preset for faster processing
            `-q:v ${videoQuality}`    // Video quality from configuration
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

// ===== Post-processing Functions =====

// SSIM Fingerprint Configuration
const SSIM_FINGERPRINT_SIZE = 64;         // 64x64 pixel image for fingerprint calculation
const SSIM_BLOCK_SIZE = 8;                // 8x8 blocks for local feature extraction
const SSIM_BLOCKS_PER_DIMENSION = SSIM_FINGERPRINT_SIZE / SSIM_BLOCK_SIZE; // 8x8 = 64 blocks total
const SSIM_SIMILARITY_THRESHOLD = 0.95;   // Default similarity threshold for SSIM fingerprint comparison

// Region-based Comparison Configuration
const REGION_ALIGNMENT_TYPES = {
  TOP_LEFT: 'top-left',
  TOP_CENTER: 'top-center', 
  TOP_RIGHT: 'top-right',
  CENTER_LEFT: 'center-left',
  CENTER: 'center',
  CENTER_RIGHT: 'center-right',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_CENTER: 'bottom-center',
  BOTTOM_RIGHT: 'bottom-right'
};

// Default region configuration for full image comparison
const DEFAULT_REGION_CONFIG = {
  enabled: false,
  width: null,    // null means use full image width
  height: null,   // null means use full image height
  alignment: REGION_ALIGNMENT_TYPES.CENTER
};

// Fingerprint Storage Management
const fingerprintStorageDir = path.join(app.getPath('userData'), 'fingerprints');
const fingerprintIndexFile = path.join(fingerprintStorageDir, 'index.json');

// Flag to prevent recursive initialization
let isInitializingFingerprints = false;

/**
 * Ensure fingerprint storage directory exists and initialize preset fingerprints
 */
function ensureFingerprintStorageExists() {
  try {
    if (!fs.existsSync(fingerprintStorageDir)) {
      fs.mkdirSync(fingerprintStorageDir, { recursive: true });
    }
    
    // Create index file if it doesn't exist
    if (!fs.existsSync(fingerprintIndexFile)) {
      const initialIndex = {
        version: 1,
        fingerprints: {}
      };
      fs.writeFileSync(fingerprintIndexFile, JSON.stringify(initialIndex, null, 2));
    }
    
    // Initialize preset fingerprints only if not already initializing to prevent recursion
    if (!isInitializingFingerprints) {
      initializePresetFingerprints();
    }
    
  } catch (error) {
    console.error('Error ensuring fingerprint storage exists:', error);
  }
}

/**
 * Get the preset fingerprints directory path
 * @returns {string} Preset fingerprints directory path
 */
function getPresetFingerprintsDir() {
  if (app.isPackaged) {
    // In production: use resources/assets/fp
    if (process.platform === 'win32') {
      // Windows: resources/assets/fp
      return path.join(process.resourcesPath, 'assets', 'fp');
    } else if (process.platform === 'darwin') {
      // macOS: Contents/Resources/assets/fp
      return path.join(process.resourcesPath, 'assets', 'fp');
    } else {
      // Linux and others: resources/assets/fp
      return path.join(process.resourcesPath, 'assets', 'fp');
    }
  } else {
    // In development: use src/assets/fp relative to main.js
    return path.join(__dirname, '..', 'assets', 'fp');
  }
}

/**
 * Load preset configuration from presets.json
 * @returns {Object} Preset configuration object
 */
function loadPresetConfig() {
  try {
    const presetDir = getPresetFingerprintsDir();
    const configPath = path.join(presetDir, 'presets.json');
    
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      
      // Ensure default region config exists
      if (!config.defaultRegionConfig) {
        config.defaultRegionConfig = DEFAULT_REGION_CONFIG;
      }
      
      // Ensure each preset has region config with defaults
      Object.keys(config.presets || {}).forEach(presetName => {
        const preset = config.presets[presetName];
        if (!preset.regionConfig) {
          preset.regionConfig = { ...DEFAULT_REGION_CONFIG };
        } else {
          // Merge with defaults to ensure all properties exist
          preset.regionConfig = { ...DEFAULT_REGION_CONFIG, ...preset.regionConfig };
        }
      });
      
      return config;
    }
    
    // Return default config if file doesn't exist
    return {
      version: "1.0.0",
      description: "Preset Fingerprint Configuration File",
      presets: {},
      defaultThreshold: SSIM_SIMILARITY_THRESHOLD,
      defaultRegionConfig: DEFAULT_REGION_CONFIG
    };
  } catch (error) {
    console.error('Error loading preset config:', error);
    return {
      version: "1.0.0", 
      presets: {},
      defaultThreshold: SSIM_SIMILARITY_THRESHOLD,
      defaultRegionConfig: DEFAULT_REGION_CONFIG
    };
  }
}

/**
 * Initialize preset fingerprints - copy from assets to user storage and configure
 */
function initializePresetFingerprints() {
  // Prevent recursive calls
  if (isInitializingFingerprints) {
    return;
  }
  
  try {
    isInitializingFingerprints = true;
    
    const presetDir = getPresetFingerprintsDir();
    
    // Check if preset directory exists
    if (!fs.existsSync(presetDir)) {
      if (DEBUG_MODE) {
        console.log('No preset fingerprints directory found, skipping initialization');
      }
      return;
    }
    
    // Load preset configuration
    const presetConfig = loadPresetConfig();
    
    // Get version file to track preset version
    const versionFile = path.join(fingerprintStorageDir, 'preset_version.txt');
    const currentVersion = getPresetVersion();
    
    let installedVersion = '0';
    if (fs.existsSync(versionFile)) {
      installedVersion = fs.readFileSync(versionFile, 'utf8').trim();
    }
    
    // Only initialize if version changed or first time
    if (installedVersion !== currentVersion) {
      if (DEBUG_MODE) {
        console.log(`Initializing preset fingerprints (version ${installedVersion} -> ${currentVersion})`);
      }
      
      // Get all .fp files from preset directory
      const presetFiles = fs.readdirSync(presetDir)
        .filter(file => file.endsWith('.fp'))
        .map(file => ({
          filename: file,
          name: path.basename(file, '.fp'),
          sourcePath: path.join(presetDir, file)
        }));
      
      if (presetFiles.length > 0) {
        const index = loadFingerprintIndex();
        const config = loadConfig();
        
        // Ensure excludeFingerprints array exists
        if (!config.excludeFingerprints) {
          config.excludeFingerprints = [];
        }
        
        for (const preset of presetFiles) {
          const presetId = `preset_${preset.name}`;
          const targetPath = getFingerprintFilePath(presetId);
          
          // Copy preset file to storage
          fs.copyFileSync(preset.sourcePath, targetPath);
          
          // Get preset configuration for this fingerprint
          const presetInfo = presetConfig.presets[preset.name];
          const presetName = presetInfo?.name || `[PRESET] ${preset.name.replace(/_/g, ' ')}`;
          const presetThreshold = presetInfo?.threshold || presetConfig.defaultThreshold || SSIM_SIMILARITY_THRESHOLD;
          const presetRegionConfig = presetInfo?.regionConfig || presetConfig.defaultRegionConfig || DEFAULT_REGION_CONFIG;
          
          // Add to index
          const fileStats = fs.statSync(targetPath);
          index.fingerprints[presetId] = {
            id: presetId,
            name: presetName,
            threshold: presetThreshold,
            sourcePath: null, // Mark as preset
            filePath: targetPath,
            size: fileStats.size,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            fingerprint: {
              version: 1,
              preset: true,
              regionConfig: presetRegionConfig && presetRegionConfig.enabled ? presetRegionConfig : null
            }
          };
          
          // Add to exclude list if not already present
          if (!config.excludeFingerprints.includes(presetId)) {
            config.excludeFingerprints.push(presetId);
          }
          
          if (presetInfo) {
            if (DEBUG_MODE) {
              const regionInfo = presetRegionConfig && presetRegionConfig.enabled 
                ? ` (region: ${presetRegionConfig.width || 'full'}x${presetRegionConfig.height || 'full'} @ ${presetRegionConfig.alignment})`
                : ' (full image)';
              console.log(`Initialized preset ${preset.name}: ${presetName} (threshold: ${presetThreshold})${regionInfo}`);
            }
          } else {
            if (DEBUG_MODE) {
              const regionInfo = presetRegionConfig && presetRegionConfig.enabled 
                ? ` (region: ${presetRegionConfig.width || 'full'}x${presetRegionConfig.height || 'full'} @ ${presetRegionConfig.alignment})`
                : ' (full image)';
              console.log(`Initialized preset ${preset.name} with default threshold: ${presetThreshold}${regionInfo}`);
            }
          }
        }
        
        // Save updated index and config without triggering recursion
        saveFingerprintIndexDirect(index);
        saveConfig(config);
        
        if (DEBUG_MODE) {
          console.log(`Initialized ${presetFiles.length} preset fingerprints`);
        }
      }
      
      // Update version file
      fs.writeFileSync(versionFile, currentVersion);
    }
    
  } catch (error) {
    console.error('Error initializing preset fingerprints:', error);
  } finally {
    isInitializingFingerprints = false;
  }
}

/**
 * Get current preset version (based on app version and preset files)
 * @returns {string} Version string
 */
function getPresetVersion() {
  try {
    const appVersion = app.getVersion();
    const presetDir = getPresetFingerprintsDir();
    
    if (!fs.existsSync(presetDir)) {
      return `${appVersion}_no_presets`;
    }
    
    // Include file count and modification times in version
    const presetFiles = fs.readdirSync(presetDir).filter(f => f.endsWith('.fp'));
    
    // Include config file modification time if it exists
    const configPath = path.join(presetDir, 'presets.json');
    let configInfo = '';
    if (fs.existsSync(configPath)) {
      const configStats = fs.statSync(configPath);
      configInfo = `config:${configStats.mtime.getTime()}`;
    }
    
    const fileInfo = presetFiles.map(f => {
      const stats = fs.statSync(path.join(presetDir, f));
      return `${f}:${stats.mtime.getTime()}`;
    }).concat(configInfo ? [configInfo] : []).join('|');
    
    return `${appVersion}_${presetFiles.length}_${Buffer.from(fileInfo).toString('base64').substring(0, 8)}`;
  } catch (error) {
    return `${app.getVersion()}_error`;
  }
}

/**
 * Generate a unique ID for fingerprint storage
 * @param {string} name - Human readable name for the fingerprint
 * @returns {string} Unique ID
 */
function generateFingerprintId(name = '') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 20);
  return `${sanitizedName}_${timestamp}_${random}`;
}

/**
 * Get the file path for a fingerprint ID
 * @param {string} id - Fingerprint ID
 * @returns {string} File path (cross-platform)
 */
function getFingerprintFilePath(id) {
  return path.join(fingerprintStorageDir, `${id}.fp`);
}

/**
 * Load fingerprint index
 * @returns {Object} Fingerprint index
 */
function loadFingerprintIndex() {
  try {
    // Only ensure storage exists if not currently initializing to prevent recursion
    if (!isInitializingFingerprints) {
      ensureFingerprintStorageExists();
    }
    
    if (fs.existsSync(fingerprintIndexFile)) {
      const indexData = fs.readFileSync(fingerprintIndexFile, 'utf8');
      const index = JSON.parse(indexData);
      
      // Validate and clean up index
      return validateAndCleanIndex(index);
    }
    
    return {
      version: 1,
      fingerprints: {}
    };
  } catch (error) {
    console.error('Error loading fingerprint index:', error);
    return {
      version: 1,
      fingerprints: {}
    };
  }
}

/**
 * Validate and clean up fingerprint index
 * @param {Object} index - Raw index data
 * @returns {Object} Validated and cleaned index
 */
function validateAndCleanIndex(index) {
  const cleanIndex = {
    version: index.version || 1,
    fingerprints: {}
  };
  
  // Validate each fingerprint entry
  Object.keys(index.fingerprints || {}).forEach(id => {
    const fingerprint = index.fingerprints[id];
    const filePath = getFingerprintFilePath(id);
    
    // Check if binary file exists
    if (fs.existsSync(filePath)) {
      cleanIndex.fingerprints[id] = {
        id: fingerprint.id || id,
        name: fingerprint.name || `Fingerprint_${id}`,
        threshold: typeof fingerprint.threshold === 'number' ? fingerprint.threshold : SSIM_SIMILARITY_THRESHOLD,
        sourcePath: fingerprint.sourcePath || null,
        filePath: fingerprint.filePath || filePath,
        size: fingerprint.size || 0,
        createdAt: fingerprint.createdAt || new Date().toISOString(),
        updatedAt: fingerprint.updatedAt || fingerprint.createdAt || new Date().toISOString(),
        fingerprint: fingerprint.fingerprint || {}
      };
    } else {
      console.warn(`Fingerprint file not found for ID ${id}, removing from index`);
    }
  });
  
  return cleanIndex;
}

/**
 * Save fingerprint index directly without triggering sync (for internal use)
 * @param {Object} index - Fingerprint index
 * @returns {boolean} Success status
 */
function saveFingerprintIndexDirect(index) {
  try {
    ensureFingerprintStorageExists();
    fs.writeFileSync(fingerprintIndexFile, JSON.stringify(index, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving fingerprint index directly:', error);
    return false;
  }
}

/**
 * Save fingerprint index and sync with config
 * @param {Object} index - Fingerprint index
 * @returns {boolean} Success status
 */
function saveFingerprintIndex(index) {
  try {
    ensureFingerprintStorageExists();
    fs.writeFileSync(fingerprintIndexFile, JSON.stringify(index, null, 2));
    
    // Only sync if not currently initializing to prevent recursion
    if (!isInitializingFingerprints) {
      syncFingerprintsWithConfig();
    }
    
    return true;
  } catch (error) {
    console.error('Error saving fingerprint index:', error);
    return false;
  }
}

/**
 * Sync fingerprints between index and config
 * This ensures config.excludeFingerprints only contains valid fingerprint IDs
 */
function syncFingerprintsWithConfig() {
  try {
    const config = loadConfig();
    const index = loadFingerprintIndex();
    
    // Clean up excludeFingerprints to only contain valid IDs
    if (config.excludeFingerprints) {
      config.excludeFingerprints = config.excludeFingerprints
        .filter(item => {
          // Support both old format {id, threshold, name} and new format (just ID string)
          const id = typeof item === 'string' ? item : item.id;
          return id && index.fingerprints[id];
        })
        .map(item => typeof item === 'string' ? item : item.id); // Convert to ID-only format
    } else {
      config.excludeFingerprints = [];
    }
    
    saveConfig(config);
  } catch (error) {
    console.error('Error syncing fingerprints with config:', error);
  }
}

/**
 * Get fingerprint metadata by ID from index
 * @param {string} id - Fingerprint ID
 * @returns {Object|null} Fingerprint metadata or null if not found
 */
function getFingerprintMetadata(id) {
  try {
    const index = loadFingerprintIndex();
    return index.fingerprints[id] || null;
  } catch (error) {
    console.error('Error getting fingerprint metadata:', error);
    return null;
  }
}

/**
 * Update fingerprint metadata in index
 * @param {string} id - Fingerprint ID
 * @param {Object} updates - Updates to apply
 * @returns {boolean} Success status
 */
function updateFingerprintMetadata(id, updates) {
  try {
    const index = loadFingerprintIndex();
    
    if (!index.fingerprints[id]) {
      return false;
    }
    
    // Apply updates
    Object.assign(index.fingerprints[id], updates, {
      updatedAt: new Date().toISOString()
    });
    
    return saveFingerprintIndex(index);
  } catch (error) {
    console.error('Error updating fingerprint metadata:', error);
    return false;
  }
}

/**
 * Store SSIM fingerprint with metadata
 * @param {Object} fingerprint - SSIM fingerprint object
 * @param {string} name - Human readable name
 * @param {number} threshold - Default threshold for this fingerprint
 * @param {string} sourcePath - Original image path (optional)
 * @param {Object} regionConfig - Region configuration (optional)
 * @returns {Object} Storage result with ID
 */
async function storeFingerprintWithMetadata(fingerprint, name, threshold = SSIM_SIMILARITY_THRESHOLD, sourcePath = null, regionConfig = null) {
  try {
    ensureFingerprintStorageExists();
    
    // Generate unique ID
    const id = generateFingerprintId(name);
    
    // Serialize fingerprint to binary
    const binaryData = serializeSSIMFingerprint(fingerprint);
    
    // Save binary data to file
    const filePath = getFingerprintFilePath(id);
    await fs.promises.writeFile(filePath, binaryData);
    
    // Update index
    const index = loadFingerprintIndex();
    index.fingerprints[id] = {
      id,
      name,
      threshold,
      sourcePath,
      filePath,
      size: binaryData.length,
      createdAt: new Date().toISOString(),
      fingerprint: {
        version: fingerprint.version,
        size: fingerprint.size,
        blockSize: fingerprint.blockSize,
        blockCount: fingerprint.blocks.length,
        regionConfig: regionConfig && regionConfig.enabled ? regionConfig : null
      }
    };
    
    const saved = saveFingerprintIndex(index);
    
    if (saved) {
      return {
        success: true,
        id,
        filePath,
        size: binaryData.length,
        metadata: index.fingerprints[id]
      };
    } else {
      throw new Error('Failed to save fingerprint index');
    }
  } catch (error) {
    console.error('Error storing fingerprint:', error);
    throw error;
  }
}

/**
 * Load SSIM fingerprint by ID
 * @param {string} id - Fingerprint ID
 * @returns {Object} Loaded fingerprint with metadata
 */
async function loadFingerprintById(id) {
  try {
    const index = loadFingerprintIndex();
    const metadata = index.fingerprints[id];
    
    if (!metadata) {
      throw new Error(`Fingerprint with ID '${id}' not found`);
    }
    
    // Check if file exists
    const filePath = getFingerprintFilePath(id);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Fingerprint file not found: ${filePath}`);
    }
    
    // Load binary data
    const binaryData = await fs.promises.readFile(filePath);
    
    // Deserialize fingerprint
    const fingerprint = deserializeSSIMFingerprint(binaryData);
    
    // For preset fingerprints, restore region configuration from metadata
    if (metadata.fingerprint && metadata.fingerprint.regionConfig) {
      fingerprint.regionConfig = metadata.fingerprint.regionConfig;
    }
    
    return {
      success: true,
      id,
      fingerprint,
      metadata,
      binaryData: binaryData.toString('base64')
    };
  } catch (error) {
    console.error('Error loading fingerprint by ID:', error);
    throw error;
  }
}

/**
 * Delete fingerprint by ID
 * @param {string} id - Fingerprint ID
 * @returns {boolean} Success status
 */
async function deleteFingerprintById(id) {
  try {
    const index = loadFingerprintIndex();
    
    if (!index.fingerprints[id]) {
      return false; // Not found
    }
    
    // Delete file
    const filePath = getFingerprintFilePath(id);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
    
    // Remove from index
    delete index.fingerprints[id];
    
    return saveFingerprintIndex(index);
  } catch (error) {
    console.error('Error deleting fingerprint:', error);
    return false;
  }
}

/**
 * Calculate SSIM-based fingerprint for an image
 * @param {Buffer} imageBuffer - Image data buffer
 * @param {Object} regionConfig - Region configuration for partial comparison
 * @returns {Object} SSIM fingerprint object
 */
async function calculateSSIMFingerprint(imageBuffer, regionConfig = DEFAULT_REGION_CONFIG) {
  try {
    // Create image processor
    const imageProcessor = createImageProcessor(imageBuffer);
    const metadata = await imageProcessor.getMetadata();
    
    if (DEBUG_MODE && regionConfig.enabled) {
      console.log(`[SSIM Debug] Calculating fingerprint with region config:`, regionConfig);
      console.log(`[SSIM Debug] Original image dimensions: ${metadata.width}x${metadata.height}`);
    }
    
    let processedImage;
    
    if (regionConfig.enabled && (regionConfig.width || regionConfig.height)) {
      // Extract region from image before processing
      const regionData = calculateRegionBounds(metadata.width, metadata.height, regionConfig);
      
      if (DEBUG_MODE) {
        console.log(`[SSIM Debug] Calculated region bounds:`, regionData);
      }
      
      processedImage = await extractImageRegion(imageProcessor, regionData);
      
      // Verify region extraction worked correctly
      const regionMetadata = await processedImage.getMetadata();
      if (DEBUG_MODE) {
        console.log(`[SSIM Debug] Extracted region dimensions: ${regionMetadata.width}x${regionMetadata.height}`);
      }
    } else {
      // Use full image
      processedImage = imageProcessor;
      
      if (DEBUG_MODE) {
        console.log(`[SSIM Debug] Using full image for fingerprint calculation`);
      }
    }
    
    // Resize to standard fingerprint size and convert to grayscale
    const resized = await processedImage.resize(SSIM_FINGERPRINT_SIZE, SSIM_FINGERPRINT_SIZE).toGrayscale();
    const pixelData = resized;
    
    // Initialize fingerprint structure
    const fingerprint = {
      version: 1,
      size: SSIM_FINGERPRINT_SIZE,
      blockSize: SSIM_BLOCK_SIZE,
      blocks: [],
      regionConfig: regionConfig.enabled ? regionConfig : null
    };
    
    // Validate pixel data before processing
    if (!pixelData || pixelData.length === 0) {
      throw new Error('Invalid pixel data: empty or null');
    }
    
    const expectedPixelCount = SSIM_FINGERPRINT_SIZE * SSIM_FINGERPRINT_SIZE;
    if (pixelData.length !== expectedPixelCount) {
      console.warn(`[SSIM Warning] Pixel data length mismatch. Expected: ${expectedPixelCount}, Got: ${pixelData.length}`);
    }
    
    if (DEBUG_MODE && regionConfig.enabled) {
      // Sample some pixel values to verify data integrity
      const samplePixels = Array.from(pixelData.slice(0, Math.min(20, pixelData.length)));
      console.log(`[SSIM Debug] Sample pixel values:`, samplePixels);
    }
    
    // Process each 8x8 block
    for (let blockY = 0; blockY < SSIM_BLOCKS_PER_DIMENSION; blockY++) {
      for (let blockX = 0; blockX < SSIM_BLOCKS_PER_DIMENSION; blockX++) {
        const blockFeatures = calculateBlockFeatures(
          pixelData, 
          SSIM_FINGERPRINT_SIZE, 
          blockX * SSIM_BLOCK_SIZE, 
          blockY * SSIM_BLOCK_SIZE, 
          SSIM_BLOCK_SIZE
        );
        fingerprint.blocks.push(blockFeatures);
      }
    }
    
    return fingerprint;
  } catch (error) {
    console.error('Error calculating SSIM fingerprint:', error);
    throw error;
  }
}

/**
 * Calculate region bounds based on alignment and target dimensions
 * @param {number} imageWidth - Original image width
 * @param {number} imageHeight - Original image height
 * @param {Object} regionConfig - Region configuration
 * @returns {Object} Region bounds {x, y, width, height}
 */
function calculateRegionBounds(imageWidth, imageHeight, regionConfig) {
  const targetWidth = regionConfig.width || imageWidth;
  const targetHeight = regionConfig.height || imageHeight;
  
  // Ensure target dimensions don't exceed image dimensions
  const finalWidth = Math.min(targetWidth, imageWidth);
  const finalHeight = Math.min(targetHeight, imageHeight);
  
  let x = 0, y = 0;
  
  // Calculate position based on alignment
  switch (regionConfig.alignment) {
    case REGION_ALIGNMENT_TYPES.TOP_LEFT:
      x = 0;
      y = 0;
      break;
    case REGION_ALIGNMENT_TYPES.TOP_CENTER:
      x = Math.floor((imageWidth - finalWidth) / 2);
      y = 0;
      break;
    case REGION_ALIGNMENT_TYPES.TOP_RIGHT:
      x = imageWidth - finalWidth;
      y = 0;
      break;
    case REGION_ALIGNMENT_TYPES.CENTER_LEFT:
      x = 0;
      y = Math.floor((imageHeight - finalHeight) / 2);
      break;
    case REGION_ALIGNMENT_TYPES.CENTER:
      x = Math.floor((imageWidth - finalWidth) / 2);
      y = Math.floor((imageHeight - finalHeight) / 2);
      break;
    case REGION_ALIGNMENT_TYPES.CENTER_RIGHT:
      x = imageWidth - finalWidth;
      y = Math.floor((imageHeight - finalHeight) / 2);
      break;
    case REGION_ALIGNMENT_TYPES.BOTTOM_LEFT:
      x = 0;
      y = imageHeight - finalHeight;
      break;
    case REGION_ALIGNMENT_TYPES.BOTTOM_CENTER:
      x = Math.floor((imageWidth - finalWidth) / 2);
      y = imageHeight - finalHeight;
      break;
    case REGION_ALIGNMENT_TYPES.BOTTOM_RIGHT:
      x = imageWidth - finalWidth;
      y = imageHeight - finalHeight;
      break;
    default:
      // Default to center
      x = Math.floor((imageWidth - finalWidth) / 2);
      y = Math.floor((imageHeight - finalHeight) / 2);
  }
  
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: finalWidth,
    height: finalHeight
  };
}

/**
 * Extract a region from an image
 * @param {Object} imageProcessor - Image processor instance
 * @param {Object} regionBounds - Region bounds {x, y, width, height}
 * @returns {Object} New image processor with extracted region
 */
async function extractImageRegion(imageProcessor, regionBounds) {
  try {
    const metadata = await imageProcessor.getMetadata();
    const pixelData = await imageProcessor.decode();
    
    if (!pixelData) {
      throw new Error('Failed to decode image data');
    }
    
    // Create new pixel data for the region
    const regionPixelData = new Uint8Array(regionBounds.width * regionBounds.height * 3);
    
    // Extract region pixels with bounds checking
    for (let y = 0; y < regionBounds.height; y++) {
      for (let x = 0; x < regionBounds.width; x++) {
        const srcX = regionBounds.x + x;
        const srcY = regionBounds.y + y;
        
        // Ensure we don't go out of bounds
        if (srcX < metadata.width && srcY < metadata.height) {
          const srcIdx = (srcY * metadata.width + srcX) * 3;
          const dstIdx = (y * regionBounds.width + x) * 3;
          
          regionPixelData[dstIdx] = pixelData[srcIdx];
          regionPixelData[dstIdx + 1] = pixelData[srcIdx + 1];
          regionPixelData[dstIdx + 2] = pixelData[srcIdx + 2];
        } else {
          // Fill out-of-bounds areas with black pixels
          const dstIdx = (y * regionBounds.width + x) * 3;
          regionPixelData[dstIdx] = 0;
          regionPixelData[dstIdx + 1] = 0;
          regionPixelData[dstIdx + 2] = 0;
        }
      }
    }
    
    // Create a custom image processor that directly works with the extracted pixel data
    // Instead of trying to create from a buffer (which expects image file data)
    const regionProcessor = {
      async getMetadata() {
        return {
          width: regionBounds.width,
          height: regionBounds.height,
          format: metadata.format
        };
      },
      
      async decode() {
        return regionPixelData;
      },
      
      async toGrayscale() {
        const width = regionBounds.width;
        const height = regionBounds.height;
        
        // Create grayscale pixel array (1 byte per pixel)
        const grayscale = new Uint8Array(width * height);
        
        // Convert RGB to grayscale using luminance formula
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 3;
            const r = regionPixelData[idx];
            const g = regionPixelData[idx + 1];
            const b = regionPixelData[idx + 2];
            
            // Standard luminance formula
            grayscale[y * width + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
          }
        }
        
        return grayscale;
      },
      
      resize(width, height = null, options = {}) {
        // If height is null, maintain aspect ratio
        if (height === null && regionBounds.height && regionBounds.width) {
          height = Math.round(regionBounds.height * (width / regionBounds.width));
        }
        
        // Create a new processor instance for the resized image
        const resizedProcessor = {
          async getMetadata() {
            return { width, height, format: metadata.format };
          },
          
          async decode() {
            const sourceWidth = regionBounds.width;
            const sourceHeight = regionBounds.height;
            
            if (!regionPixelData) return null;
            
            const targetPixels = new Uint8Array(width * height * 3);
            
            // Simple nearest-neighbor scaling
            for (let y = 0; y < height; y++) {
              for (let x = 0; x < width; x++) {
                // Map target coordinates to source coordinates
                const srcX = Math.floor(x * sourceWidth / width);
                const srcY = Math.floor(y * sourceHeight / height);
                
                // Get source pixel
                const srcIdx = (srcY * sourceWidth + srcX) * 3;
                const tgtIdx = (y * width + x) * 3;
                
                // Copy RGB values
                targetPixels[tgtIdx] = regionPixelData[srcIdx];
                targetPixels[tgtIdx + 1] = regionPixelData[srcIdx + 1];
                targetPixels[tgtIdx + 2] = regionPixelData[srcIdx + 2];
              }
            }
            
            return targetPixels;
          },
          
          async toGrayscale() {
            const targetPixels = await this.decode(); // Use the resized decode function
            const grayscale = new Uint8Array(width * height);
            
            // Convert RGB to grayscale using luminance formula
            for (let y = 0; y < height; y++) {
              for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 3;
                const r = targetPixels[idx];
                const g = targetPixels[idx + 1];
                const b = targetPixels[idx + 2];
                
                // Standard luminance formula
                grayscale[y * width + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
              }
            }
            
            return grayscale;
          },
          
          resize: function(newWidth, newHeight = null, newOptions = {}) {
            return regionProcessor.resize(newWidth, newHeight, newOptions);
          }
        };
        
        return resizedProcessor;
      }
    };
    
    return regionProcessor;
  } catch (error) {
    console.error('Error extracting image region:', error);
    throw error;
  }
}

/**
 * Calculate features for a single block
 * @param {Uint8Array} pixelData - Grayscale pixel data
 * @param {number} imageWidth - Image width
 * @param {number} startX - Block start X coordinate
 * @param {number} startY - Block start Y coordinate
 * @param {number} blockSize - Block size (8x8)
 * @returns {Object} Block features
 */
function calculateBlockFeatures(pixelData, imageWidth, startX, startY, blockSize) {
  const pixels = [];
  let sum = 0;
  
  // Extract block pixels
  for (let y = startY; y < startY + blockSize; y++) {
    for (let x = startX; x < startX + blockSize; x++) {
      const pixelValue = pixelData[y * imageWidth + x];
      pixels.push(pixelValue);
      sum += pixelValue;
    }
  }
  
  // Calculate mean
  const mean = sum / (blockSize * blockSize);
  
  // Calculate variance
  let variance = 0;
  for (const pixel of pixels) {
    const diff = pixel - mean;
    variance += diff * diff;
  }
  variance /= (blockSize * blockSize);
  
  // Calculate gradient information (edge detection)
  let gradientX = 0, gradientY = 0;
  for (let y = 1; y < blockSize - 1; y++) {
    for (let x = 1; x < blockSize - 1; x++) {
      const idx = y * blockSize + x;
      
      // Sobel operators
      gradientX += pixels[idx + 1] - pixels[idx - 1];
      gradientY += pixels[(y + 1) * blockSize + x] - pixels[(y - 1) * blockSize + x];
    }
  }
  
  // Calculate dominant gradient direction (0-7, representing 8 directions)
  const gradientAngle = Math.atan2(gradientY, gradientX);
  const gradientDirection = Math.floor(((gradientAngle + Math.PI) / (2 * Math.PI)) * 8) % 8;
  
  // Calculate gradient magnitude
  const gradientMagnitude = Math.sqrt(gradientX * gradientX + gradientY * gradientY);
  
  return {
    mean: Math.round(mean),
    variance: Math.round(variance),
    gradientDirection,
    gradientMagnitude: Math.round(gradientMagnitude)
  };
}

/**
 * Compare two SSIM fingerprints and return similarity score
 * @param {Object} fingerprint1 - First fingerprint
 * @param {Object} fingerprint2 - Second fingerprint
 * @returns {number} Similarity score (0-1, where 1 is identical)
 */
function compareSSIMFingerprints(fingerprint1, fingerprint2) {
  try {
    // Validate fingerprints
    if (!fingerprint1 || !fingerprint2 || 
        !fingerprint1.blocks || !fingerprint2.blocks ||
        fingerprint1.blocks.length !== fingerprint2.blocks.length) {
      return 0;
    }
    
    const blockCount = fingerprint1.blocks.length;
    let totalSimilarity = 0;
    
    // Check for potentially corrupted fingerprints (all blocks identical)
    if (DEBUG_MODE && blockCount > 1) {
      const firstBlock1 = fingerprint1.blocks[0];
      const firstBlock2 = fingerprint2.blocks[0];
      
      // Check if all blocks in fingerprint1 are identical (sign of corruption)
      const allIdentical1 = fingerprint1.blocks.every(block => 
        block.mean === firstBlock1.mean && 
        block.variance === firstBlock1.variance &&
        block.gradientDirection === firstBlock1.gradientDirection &&
        block.gradientMagnitude === firstBlock1.gradientMagnitude
      );
      
      // Check if all blocks in fingerprint2 are identical (sign of corruption)
      const allIdentical2 = fingerprint2.blocks.every(block => 
        block.mean === firstBlock2.mean && 
        block.variance === firstBlock2.variance &&
        block.gradientDirection === firstBlock2.gradientDirection &&
        block.gradientMagnitude === firstBlock2.gradientMagnitude
      );
      
      if (allIdentical1 || allIdentical2) {
        console.warn(`[SSIM Warning] Potentially corrupted fingerprint detected - all blocks identical`);
        console.warn(`[SSIM Warning] FP1 identical blocks: ${allIdentical1}, FP2 identical blocks: ${allIdentical2}`);
      }
    }
    
    // Compare each corresponding block
    for (let i = 0; i < blockCount; i++) {
      const block1 = fingerprint1.blocks[i];
      const block2 = fingerprint2.blocks[i];
      
      // Calculate similarity for each feature
      const meanSimilarity = 1 - Math.abs(block1.mean - block2.mean) / 255;
      const varianceSimilarity = 1 - Math.min(Math.abs(block1.variance - block2.variance) / 10000, 1);
      
      // Direction similarity (circular distance)
      const directionDiff = Math.min(
        Math.abs(block1.gradientDirection - block2.gradientDirection),
        8 - Math.abs(block1.gradientDirection - block2.gradientDirection)
      );
      const directionSimilarity = 1 - directionDiff / 4;
      
      // Gradient magnitude similarity
      const magnitudeSimilarity = 1 - Math.min(Math.abs(block1.gradientMagnitude - block2.gradientMagnitude) / 1000, 1);
      
      // Weighted average of features (mean and variance are more important)
      const blockSimilarity = (
        meanSimilarity * 0.4 +
        varianceSimilarity * 0.3 +
        directionSimilarity * 0.2 +
        magnitudeSimilarity * 0.1
      );
      
      totalSimilarity += blockSimilarity;
    }
    
    return totalSimilarity / blockCount;
  } catch (error) {
    console.error('Error comparing SSIM fingerprints:', error);
    return 0;
  }
}

/**
 * Serialize SSIM fingerprint to binary data for storage
 * @param {Object} fingerprint - SSIM fingerprint object
 * @returns {Buffer} Binary data buffer
 */
function serializeSSIMFingerprint(fingerprint) {
  try {
    // Calculate buffer size: version(1) + size(1) + blockSize(1) + blockCount(1) + blocks data
    const blockCount = fingerprint.blocks.length;
    const bufferSize = 4 + blockCount * 5; // 5 bytes per block (mean:1, variance:2, direction:1, magnitude:1)
    
    const buffer = Buffer.alloc(bufferSize);
    let offset = 0;
    
    // Write header
    buffer.writeUInt8(fingerprint.version, offset++);
    buffer.writeUInt8(fingerprint.size, offset++);
    buffer.writeUInt8(fingerprint.blockSize, offset++);
    buffer.writeUInt8(blockCount, offset++);
    
    // Write block data
    for (const block of fingerprint.blocks) {
      buffer.writeUInt8(Math.min(255, Math.max(0, block.mean)), offset++);
      buffer.writeUInt16BE(Math.min(65535, Math.max(0, block.variance)), offset);
      offset += 2;
      buffer.writeUInt8(Math.min(7, Math.max(0, block.gradientDirection)), offset++);
      buffer.writeUInt8(Math.min(255, Math.max(0, Math.floor(block.gradientMagnitude / 4))), offset++); // Scale down magnitude
    }
    
    return buffer;
  } catch (error) {
    console.error('Error serializing SSIM fingerprint:', error);
    throw error;
  }
}

/**
 * Deserialize binary data back to SSIM fingerprint object
 * @param {Buffer} buffer - Binary data buffer
 * @returns {Object} SSIM fingerprint object
 */
function deserializeSSIMFingerprint(buffer) {
  try {
    if (!buffer || buffer.length < 4) {
      throw new Error('Invalid fingerprint buffer');
    }
    
    let offset = 0;
    
    // Read header
    const version = buffer.readUInt8(offset++);
    const size = buffer.readUInt8(offset++);
    const blockSize = buffer.readUInt8(offset++);
    const blockCount = buffer.readUInt8(offset++);
    
    // Validate data
    if (buffer.length !== 4 + blockCount * 5) {
      throw new Error('Fingerprint buffer size mismatch');
    }
    
    const fingerprint = {
      version,
      size,
      blockSize,
      blocks: []
    };
    
    // Read block data
    for (let i = 0; i < blockCount; i++) {
      const mean = buffer.readUInt8(offset++);
      const variance = buffer.readUInt16BE(offset);
      offset += 2;
      const gradientDirection = buffer.readUInt8(offset++);
      const gradientMagnitude = buffer.readUInt8(offset++) * 4; // Scale back up
      
      fingerprint.blocks.push({
        mean,
        variance,
        gradientDirection,
        gradientMagnitude
      });
    }
    
    return fingerprint;
  } catch (error) {
    console.error('Error deserializing SSIM fingerprint:', error);
    throw error;
  }
}

// Calculate SSIM fingerprint for a single image and optionally store it
ipcMain.handle('calculate-image-ssim-fingerprint', async (event, { imagePath, store = false, name = '', threshold = SSIM_SIMILARITY_THRESHOLD, regionConfig = DEFAULT_REGION_CONFIG }) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Validate image path
      if (!imagePath) {
        reject(new Error('Image path is empty or undefined'));
        return;
      }

      // Check if file exists
      if (!fs.existsSync(imagePath)) {
        reject(new Error(`Image file does not exist: ${imagePath}`));
        return;
      }

      // Read image file
      const imageBuffer = await fs.promises.readFile(imagePath);
      
      // Calculate SSIM fingerprint with region support
      const fingerprint = await calculateSSIMFingerprint(imageBuffer, regionConfig);
      
      if (store) {
        // Store fingerprint with metadata
        const fileName = name || path.basename(imagePath, path.extname(imagePath));
        const storeResult = await storeFingerprintWithMetadata(fingerprint, fileName, threshold, imagePath, regionConfig);
        
        resolve({ 
          fingerprint,
          binaryData: storeResult.size > 0 ? Buffer.from(serializeSSIMFingerprint(fingerprint)).toString('base64') : null,
          size: storeResult.size,
          stored: true,
          id: storeResult.id,
          metadata: storeResult.metadata,
          regionConfig: fingerprint.regionConfig,
          success: true 
        });
      } else {
        // Just calculate, don't store
        const binaryData = serializeSSIMFingerprint(fingerprint);
        
        resolve({ 
          fingerprint,
          binaryData: binaryData.toString('base64'),
          size: binaryData.length,
          stored: false,
          regionConfig: fingerprint.regionConfig,
          success: true 
        });
      }
    } catch (error) {
      reject(`Error calculating SSIM fingerprint: ${error.message}`);
    }
  });
});

// Calculate perceptual hash for a single image (keeping for backward compatibility)
ipcMain.handle('calculate-image-hash', async (event, imagePath) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Read image file
      const imageBuffer = await fs.promises.readFile(imagePath);
      
      // Create image processor
      const imageProcessor = createImageProcessor(imageBuffer);
      const metadata = await imageProcessor.getMetadata();
      
      // Calculate perceptual hash
      const resized = await imageProcessor.resize(32, 32).toGrayscale();
      const hash = await calculatePerceptualHash(imageProcessor, resized);
      
      resolve({ hash, success: true });
    } catch (error) {
      reject(`Error calculating image hash: ${error.message}`);
    }
  });
});

// Post-process extracted slides (remove similar images based on exclude fingerprints)
ipcMain.handle('post-process-slides', async (event, { slidesDir, excludeHashes = [], excludeFingerprints = [], useSSIMFingerprint = true, ssimThreshold = SSIM_SIMILARITY_THRESHOLD }) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Get dynamic threshold values from config
      const thresholds = getThresholds();
      
      // Get configuration for SSIM settings
      const config = loadConfig();
      const useSSIM = config.useSSIMFingerprint !== undefined ? config.useSSIMFingerprint : useSSIMFingerprint;
      const defaultThreshold = config.ssimSimilarityThreshold || ssimThreshold;
      
      if (!fs.existsSync(slidesDir)) {
        reject('Slides directory does not exist');
        return;
      }
      
      // Get all slide files
      const slideFiles = fs.readdirSync(slidesDir)
        .filter(file => /\.(jpg|jpeg|png)$/i.test(file))
        .map(file => path.join(slidesDir, file));
      
      let removedCount = 0;
      let processedCount = 0;
      
      // Process each slide
      for (const slideFile of slideFiles) {
        try {
          const imageBuffer = await fs.promises.readFile(slideFile);
          let shouldRemove = false;
          
          if (useSSIM) {
            // Use SSIM fingerprint comparison
            // DON'T calculate slideFingerprint with default config here, 
            // instead calculate it for each exclude fingerprint with their specific region config
            
            // Check against exclude fingerprints (new ID-based system)
            const configFingerprints = config.excludeFingerprints || [];
            const allExcludeFingerprints = [...configFingerprints, ...excludeFingerprints];
            
            for (const excludeId of allExcludeFingerprints) {
              // Handle both old format {id, threshold, name} and new format (just ID string)
              const id = typeof excludeId === 'string' ? excludeId : excludeId.id;
              
              if (id) {
                try {
                  // Load fingerprint metadata and binary data by ID
                  const loadedFingerprint = await loadFingerprintById(id);
                  
                  if (loadedFingerprint.success) {
                    // Get threshold from index metadata
                    const metadata = getFingerprintMetadata(id);
                    const customThreshold = metadata ? metadata.threshold : defaultThreshold;
                    
                    // Get region configuration from the stored fingerprint
                    const storedRegionConfig = metadata.fingerprint?.regionConfig || DEFAULT_REGION_CONFIG;
                    
                    // Calculate slide fingerprint using the SAME region configuration as the stored fingerprint
                    // This ensures consistent comparison between preset and slide
                    const slideFingerprint = await calculateSSIMFingerprint(imageBuffer, storedRegionConfig);
                    
                    const similarity = compareSSIMFingerprints(slideFingerprint, loadedFingerprint.fingerprint);
                    if (similarity >= customThreshold) {
                      shouldRemove = true;
                      
                      if (DEBUG_MODE) {
                        const regionInfo = storedRegionConfig && storedRegionConfig.enabled 
                          ? ` (region: ${storedRegionConfig.width || 'full'}x${storedRegionConfig.height || 'full'} @ ${storedRegionConfig.alignment})`
                          : ' (full image)';
                        console.log(`Slide ${path.basename(slideFile)} matches exclude fingerprint ${id} (similarity: ${similarity.toFixed(4)}, threshold: ${customThreshold})${regionInfo}`);
                      }
                      break;
                    }
                  }
                } catch (error) {
                  console.error(`Error loading fingerprint ${id}:`, error);
                  // Continue with next exclude item
                }
              }
            }
            
            // Check against legacy exclude hashes for backward compatibility
            if (!shouldRemove) {
              for (const excludeItem of excludeHashes) {
                if (excludeItem) {
                  let excludeFingerprint;
                  let customThreshold = defaultThreshold;
                  
                  // Support both old format (string hash) and new format (SSIM fingerprint)
                  if (typeof excludeItem === 'string') {
                    // Legacy hash format - skip for SSIM comparison
                    continue;
                  } else if (excludeItem.fingerprint) {
                    // New SSIM fingerprint format (direct fingerprint data)
                    if (typeof excludeItem.fingerprint === 'string') {
                      // Base64 encoded binary data
                      const binaryData = Buffer.from(excludeItem.fingerprint, 'base64');
                      excludeFingerprint = deserializeSSIMFingerprint(binaryData);
                    } else {
                      // Direct fingerprint object
                      excludeFingerprint = excludeItem.fingerprint;
                    }
                    customThreshold = excludeItem.threshold !== undefined ? excludeItem.threshold : defaultThreshold;
                  } else if (excludeItem.hash) {
                    // Legacy hash in object format - skip for SSIM comparison
                    continue;
                  }
                  
                  if (excludeFingerprint) {
                    const similarity = compareSSIMFingerprints(slideFingerprint, excludeFingerprint);
                    if (similarity >= customThreshold) {
                      shouldRemove = true;
                      
                      if (DEBUG_MODE) {
                        console.log(`Slide ${path.basename(slideFile)} matches exclude fingerprint (similarity: ${similarity.toFixed(4)}, threshold: ${customThreshold})`);
                      }
                      break;
                    }
                  }
                }
              }
            }
          } else {
            // Use legacy perceptual hash comparison
            const imageProcessor = createImageProcessor(imageBuffer);
            const resized = await imageProcessor.resize(32, 32).toGrayscale();
            const slideHash = await calculatePerceptualHash(imageProcessor, resized);
            
            // Check against exclude hashes
            for (const excludeItem of excludeHashes) {
              if (excludeItem && slideHash) {
                // Support both old format (string) and new format (object)
                const excludeHash = typeof excludeItem === 'string' ? excludeItem : excludeItem.hash;
                const customThreshold = typeof excludeItem === 'object' ? excludeItem.threshold : 0;
                
                if (excludeHash) {
                  const hammingDistance = calculateHammingDistance(slideHash, excludeHash);
                  if (hammingDistance <= customThreshold) {
                    shouldRemove = true;
                    
                    if (DEBUG_MODE) {
                      console.log(`Slide ${path.basename(slideFile)} matches exclude hash ${excludeHash} (distance: ${hammingDistance}, threshold: ${customThreshold})`);
                    }
                    break;
                  }
                }
              }
            }
          }
          
          // Remove file if it matches exclude criteria
          if (shouldRemove) {
            await fs.promises.unlink(slideFile);
            removedCount++;
            
            if (DEBUG_MODE) {
              console.log(`Removed slide: ${path.basename(slideFile)}`);
            }
          }
          
          processedCount++;
          
          // Report progress
          const percent = Math.round((processedCount / slideFiles.length) * 100);
          event.sender.send('post-process-progress', { 
            percent, 
            processedCount, 
            totalCount: slideFiles.length,
            removedCount
          });
          
        } catch (error) {
          console.error(`Error processing slide ${slideFile}:`, error);
          // Continue with next file
        }
      }
      
      resolve({ 
        success: true, 
        processedCount, 
        removedCount,
        remainingCount: slideFiles.length - removedCount,
        method: useSSIM ? 'SSIM fingerprint' : 'perceptual hash'
      });
      
    } catch (error) {
      reject(`Error during post-processing: ${error.message}`);
    }
  });
});

// Select image file for hash calculation
ipcMain.handle('select-image-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Image Files', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'gif'] }
      ]
    });
    
    if (!result.canceled && result.filePaths.length > 0) {
      // Check if file exists
      const imagePath = result.filePaths[0];
      if (fs.existsSync(imagePath)) {
        return imagePath;
      } else {
        throw new Error(`Selected file does not exist: ${imagePath}`);
      }
    }
    return null;
  } catch (error) {
    console.error('Error selecting image file:', error);
    throw error;
  }
});

// Select slides directory for manual post-processing
ipcMain.handle('select-slides-dir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Slides Directory for Post-processing'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Save SSIM fingerprint to file
ipcMain.handle('save-ssim-fingerprint', async (event, { fingerprint, filePath }) => {
  return new Promise(async (resolve, reject) => {
    try {
      let binaryData;
      
      // Handle different input formats
      if (typeof fingerprint === 'string') {
        // Base64 encoded binary data
        binaryData = Buffer.from(fingerprint, 'base64');
      } else if (fingerprint.binaryData) {
        // Object with binaryData property
        binaryData = Buffer.from(fingerprint.binaryData, 'base64');
      } else {
        // Raw fingerprint object - serialize it
        binaryData = serializeSSIMFingerprint(fingerprint);
      }
      
      // Write to file
      await fs.promises.writeFile(filePath, binaryData);
      
      resolve({ 
        success: true, 
        filePath,
        size: binaryData.length
      });
    } catch (error) {
      reject(`Error saving SSIM fingerprint: ${error.message}`);
    }
  });
});

// Load SSIM fingerprint from file
ipcMain.handle('load-ssim-fingerprint', async (event, filePath) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Read binary data from file
      const binaryData = await fs.promises.readFile(filePath);
      
      // Deserialize to fingerprint object
      const fingerprint = deserializeSSIMFingerprint(binaryData);
      
      resolve({ 
        success: true,
        fingerprint,
        binaryData: binaryData.toString('base64'),
        size: binaryData.length
      });
    } catch (error) {
      reject(`Error loading SSIM fingerprint: ${error.message}`);
    }
  });
});

// Compare two SSIM fingerprints
ipcMain.handle('compare-ssim-fingerprints', async (event, { fingerprint1, fingerprint2 }) => {
  return new Promise(async (resolve, reject) => {
    try {
      let fp1, fp2;
      
      // Handle different input formats for fingerprint1
      if (typeof fingerprint1 === 'string') {
        // Base64 encoded binary data
        const binaryData = Buffer.from(fingerprint1, 'base64');
        fp1 = deserializeSSIMFingerprint(binaryData);
      } else {
        fp1 = fingerprint1;
      }
      
      // Handle different input formats for fingerprint2
      if (typeof fingerprint2 === 'string') {
        // Base64 encoded binary data
        const binaryData = Buffer.from(fingerprint2, 'base64');
        fp2 = deserializeSSIMFingerprint(binaryData);
      } else {
        fp2 = fingerprint2;
      }
      
      // Calculate similarity
      const similarity = compareSSIMFingerprints(fp1, fp2);
      
      resolve({ 
        success: true,
        similarity,
        isMatch: similarity >= SSIM_SIMILARITY_THRESHOLD
      });
    } catch (error) {
      reject(`Error comparing SSIM fingerprints: ${error.message}`);
    }
  });
});

// Select fingerprint file for loading
ipcMain.handle('select-fingerprint-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'SSIM Fingerprint Files', extensions: ['bin', 'fp', 'fingerprint'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Update configuration to support SSIM fingerprint settings
ipcMain.handle('update-ssim-config', async (event, config) => {
  return new Promise((resolve, reject) => {
    try {
      const currentConfig = loadConfig();
      
      // Add SSIM-specific settings
      const updatedConfig = {
        ...currentConfig,
        useSSIMFingerprint: config.useSSIMFingerprint !== undefined ? config.useSSIMFingerprint : true,
        ssimSimilarityThreshold: config.ssimSimilarityThreshold || SSIM_SIMILARITY_THRESHOLD,
        excludeFingerprints: config.excludeFingerprints || []
      };
      
      const success = saveConfig(updatedConfig);
      resolve({ success });
    } catch (error) {
      reject(`Error updating SSIM configuration: ${error.message}`);
    }
  });
});

// Store image as SSIM fingerprint with ID
ipcMain.handle('store-image-fingerprint', async (event, { imagePath, name, threshold }) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Read image file
      const imageBuffer = await fs.promises.readFile(imagePath);
      
      // Calculate SSIM fingerprint
      const fingerprint = await calculateSSIMFingerprint(imageBuffer);
      
      // Store with metadata
      const fileName = name || path.basename(imagePath, path.extname(imagePath));
      const customThreshold = threshold !== undefined ? threshold : SSIM_SIMILARITY_THRESHOLD;
      const result = await storeFingerprintWithMetadata(fingerprint, fileName, customThreshold, imagePath);
      
      resolve(result);
    } catch (error) {
      reject(`Error storing image fingerprint: ${error.message}`);
    }
  });
});

// Load fingerprint by ID
ipcMain.handle('load-fingerprint-by-id', async (event, id) => {
  return new Promise(async (resolve, reject) => {
    try {
      const result = await loadFingerprintById(id);
      resolve(result);
    } catch (error) {
      reject(`Error loading fingerprint: ${error.message}`);
    }
  });
});

// Get all stored fingerprints with complete metadata
ipcMain.handle('get-all-fingerprints', async () => {
  return new Promise((resolve, reject) => {
    try {
      const index = loadFingerprintIndex();
      const config = loadConfig();
      
      // Get list of excluded fingerprint IDs
      const excludedIds = new Set(config.excludeFingerprints || []);
      
      // Build response with complete metadata
      const fingerprints = Object.values(index.fingerprints).map(metadata => ({
        ...metadata,
        isExcluded: excludedIds.has(metadata.id)
      }));
      
      resolve({ 
        success: true, 
        fingerprints,
        excludeFingerprints: config.excludeFingerprints || []
      });
    } catch (error) {
      reject(`Error getting fingerprints: ${error.message}`);
    }
  });
});

// Get excluded fingerprints with complete metadata
ipcMain.handle('get-exclude-fingerprints', async () => {
  return new Promise((resolve, reject) => {
    try {
      const config = loadConfig();
      const index = loadFingerprintIndex();
      
      const excludeFingerprints = (config.excludeFingerprints || [])
        .map(id => {
          const metadata = index.fingerprints[id];
          return metadata ? { ...metadata, isExcluded: true } : null;
        })
        .filter(Boolean); // Remove null entries for missing fingerprints
      
      resolve({ 
        success: true, 
        excludeFingerprints,
        excludeIds: config.excludeFingerprints || []
      });
    } catch (error) {
      reject(`Error getting exclude fingerprints: ${error.message}`);
    }
  });
});

// Update fingerprint name and threshold
ipcMain.handle('update-fingerprint', async (event, { id, name, threshold }) => {
  return new Promise((resolve, reject) => {
    try {
      const updates = {};
      
      if (name !== undefined) {
        updates.name = name;
      }
      
      if (threshold !== undefined) {
        updates.threshold = threshold;
      }
      
      const success = updateFingerprintMetadata(id, updates);
      
      if (success) {
        const updatedMetadata = getFingerprintMetadata(id);
        resolve({ 
          success: true, 
          metadata: updatedMetadata 
        });
      } else {
        reject(`Failed to update fingerprint ${id}`);
      }
    } catch (error) {
      reject(`Error updating fingerprint: ${error.message}`);
    }
  });
});

// Delete fingerprint by ID
ipcMain.handle('delete-fingerprint-by-id', async (event, id) => {
  return new Promise(async (resolve, reject) => {
    try {
      const success = await deleteFingerprintById(id);
      resolve({ success, id });
    } catch (error) {
      reject(`Error deleting fingerprint: ${error.message}`);
    }
  });
});

// Add fingerprint to exclude list in config
ipcMain.handle('add-fingerprint-to-excludes', async (event, { id, threshold }) => {
  return new Promise((resolve, reject) => {
    try {
      // First check if fingerprint exists in index
      const metadata = getFingerprintMetadata(id);
      if (!metadata) {
        reject(`Fingerprint with ID '${id}' not found in index`);
        return;
      }
      
      // Update threshold in index if provided
      if (threshold !== undefined && threshold !== metadata.threshold) {
        updateFingerprintMetadata(id, { threshold });
      }
      
      const config = loadConfig();
      
      // Initialize excludeFingerprints if it doesn't exist
      if (!config.excludeFingerprints) {
        config.excludeFingerprints = [];
      }
      
      // Add to exclude list if not already present (store only ID)
      if (!config.excludeFingerprints.includes(id)) {
        config.excludeFingerprints.push(id);
      }
      
      const success = saveConfig(config);
      
      // Get updated metadata for response
      const updatedMetadata = getFingerprintMetadata(id);
      
      resolve({ 
        success, 
        excludeFingerprints: config.excludeFingerprints,
        fingerprintMetadata: updatedMetadata
      });
    } catch (error) {
      reject(`Error adding fingerprint to excludes: ${error.message}`);
    }
  });
});

// Remove fingerprint from exclude list in config
ipcMain.handle('remove-fingerprint-from-excludes', async (event, id) => {
  return new Promise((resolve, reject) => {
    try {
      const config = loadConfig();
      
      if (config.excludeFingerprints) {
        config.excludeFingerprints = config.excludeFingerprints.filter(fpId => fpId !== id);
        const success = saveConfig(config);
        resolve({ success, excludeFingerprints: config.excludeFingerprints });
      } else {
        resolve({ success: true, excludeFingerprints: [] });
      }
    } catch (error) {
      reject(`Error removing fingerprint from excludes: ${error.message}`);
    }
  });
});

// Open fingerprint storage directory in file explorer
ipcMain.handle('open-fingerprint-storage-dir', async () => {
  return new Promise((resolve, reject) => {
    try {
      ensureFingerprintStorageExists();
      shell.openPath(fingerprintStorageDir);
      resolve({ success: true, path: fingerprintStorageDir });
    } catch (error) {
      reject(`Error opening fingerprint storage directory: ${error.message}`);
    }
  });
});

// Export fingerprint to external file
ipcMain.handle('export-fingerprint', async (event, { id, exportPath }) => {
  return new Promise(async (resolve, reject) => {
    try {
      const loadResult = await loadFingerprintById(id);
      
      if (loadResult.success) {
        // Copy fingerprint file to export location
        const sourcePath = getFingerprintFilePath(id);
        await fs.promises.copyFile(sourcePath, exportPath);
        
        // Also export metadata as JSON
        const metadataPath = exportPath.replace(/\.[^.]+$/, '.json');
        const metadataContent = {
          ...loadResult.metadata,
          exportedAt: new Date().toISOString(),
          originalId: id
        };
        
        await fs.promises.writeFile(metadataPath, JSON.stringify(metadataContent, null, 2));
        
        resolve({ 
          success: true, 
          exportPath,
          metadataPath,
          size: loadResult.metadata.size
        });
      } else {
        throw new Error('Failed to load fingerprint');
      }
    } catch (error) {
      reject(`Error exporting fingerprint: ${error.message}`);
    }
  });
});

// Import fingerprint from external file
ipcMain.handle('import-fingerprint', async (event, { importPath, name, threshold }) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Read binary data
      const binaryData = await fs.promises.readFile(importPath);
      
      // Deserialize to verify it's a valid fingerprint
      const fingerprint = deserializeSSIMFingerprint(binaryData);
      
      // Store with new ID
      const fileName = name || path.basename(importPath, path.extname(importPath));
      const customThreshold = threshold !== undefined ? threshold : SSIM_SIMILARITY_THRESHOLD;
      const result = await storeFingerprintWithMetadata(fingerprint, fileName, customThreshold, importPath);
      
      resolve(result);
    } catch (error) {
      reject(`Error importing fingerprint: ${error.message}`);
    }
  });
});

// ===== Region-based Comparison IPC Handlers =====

// Get available region alignment types
ipcMain.handle('get-region-alignment-types', async () => {
  return new Promise((resolve) => {
    resolve({
      success: true,
      alignmentTypes: REGION_ALIGNMENT_TYPES,
      defaultConfig: DEFAULT_REGION_CONFIG
    });
  });
});

// Calculate region bounds for preview
ipcMain.handle('calculate-region-bounds', async (event, { imageWidth, imageHeight, regionConfig }) => {
  return new Promise((resolve, reject) => {
    try {
      const bounds = calculateRegionBounds(imageWidth, imageHeight, regionConfig);
      resolve({
        success: true,
        bounds,
        regionConfig
      });
    } catch (error) {
      reject(`Error calculating region bounds: ${error.message}`);
    }
  });
});

// Test fingerprint similarity using stored fingerprint ID and test image
ipcMain.handle('test-fingerprint-similarity', async (event, { fingerprintId, testImagePath }) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Load stored fingerprint by ID
      const loadResult = await loadFingerprintById(fingerprintId);
      if (!loadResult.success) {
        reject(`Failed to load fingerprint with ID: ${fingerprintId}`);
        return;
      }
      
      const storedFingerprint = loadResult.fingerprint;
      const metadata = loadResult.metadata;
      
      // Get region configuration from fingerprint metadata (stored in index)
      const storedRegionConfig = metadata.fingerprint?.regionConfig || DEFAULT_REGION_CONFIG;
      
      if (DEBUG_MODE) {
        console.log(`Using stored fingerprint ${fingerprintId} with region config:`, storedRegionConfig);
      }
      
      // Read test image
      const testImageBuffer = await fs.promises.readFile(testImagePath);
      
      // Calculate fingerprint for test image using the SAME region configuration as the stored fingerprint
      // This ensures consistent comparison - both fingerprints use the same region
      const testFingerprint = await calculateSSIMFingerprint(testImageBuffer, storedRegionConfig);
      
      // Compare fingerprints
      const similarity = compareSSIMFingerprints(storedFingerprint, testFingerprint);
      const threshold = metadata.threshold || SSIM_SIMILARITY_THRESHOLD;
      
      resolve({
        success: true,
        similarity,
        isMatch: similarity >= threshold,
        threshold,
        storedFingerprint: {
          id: fingerprintId,
          name: metadata.name,
          regionConfig: storedRegionConfig,
          blockCount: storedFingerprint.blocks.length
        },
        testFingerprint: {
          regionConfig: testFingerprint.regionConfig,
          blockCount: testFingerprint.blocks.length,
          stored: false // Important: test fingerprint is NOT stored
        }
      });
    } catch (error) {
      reject(`Error testing fingerprint similarity: ${error.message}`);
    }
  });
});

// Test region-based fingerprint comparison (kept for backward compatibility)
ipcMain.handle('test-region-fingerprint-similarity', async (event, { imagePath1, imagePath2, regionConfig1, regionConfig2, threshold }) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Read both images
      const imageBuffer1 = await fs.promises.readFile(imagePath1);
      const imageBuffer2 = await fs.promises.readFile(imagePath2);
      
      // Calculate fingerprints with region configurations
      const fingerprint1 = await calculateSSIMFingerprint(imageBuffer1, regionConfig1 || DEFAULT_REGION_CONFIG);
      const fingerprint2 = await calculateSSIMFingerprint(imageBuffer2, regionConfig2 || DEFAULT_REGION_CONFIG);
      
      // Compare fingerprints
      const similarity = compareSSIMFingerprints(fingerprint1, fingerprint2);
      const customThreshold = threshold !== undefined ? threshold : SSIM_SIMILARITY_THRESHOLD;
      
      resolve({
        success: true,
        similarity,
        isMatch: similarity >= customThreshold,
        threshold: customThreshold,
        fingerprint1: {
          regionConfig: fingerprint1.regionConfig,
          blockCount: fingerprint1.blocks.length
        },
        fingerprint2: {
          regionConfig: fingerprint2.regionConfig,
          blockCount: fingerprint2.blocks.length
        }
      });
    } catch (error) {
      reject(`Error testing region fingerprint similarity: ${error.message}`);
    }
  });
});

// Store image fingerprint with region configuration
ipcMain.handle('store-image-fingerprint-with-region', async (event, { imagePath, name, threshold, regionConfig }) => {
  return new Promise(async (resolve, reject) => {
    try {
      // Read image file
      const imageBuffer = await fs.promises.readFile(imagePath);
      
      // Calculate SSIM fingerprint with region configuration
      const fingerprint = await calculateSSIMFingerprint(imageBuffer, regionConfig || DEFAULT_REGION_CONFIG);
      
      // Store with metadata
      const fileName = name || path.basename(imagePath, path.extname(imagePath));
      const customThreshold = threshold !== undefined ? threshold : SSIM_SIMILARITY_THRESHOLD;
      const result = await storeFingerprintWithMetadata(fingerprint, fileName, customThreshold, imagePath, regionConfig);
      
      resolve({
        ...result,
        regionConfig: fingerprint.regionConfig
      });
    } catch (error) {
      reject(`Error storing image fingerprint with region: ${error.message}`);
    }
  });
});

// ===== Image Processing Functions for Main Process =====

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
  // Get dynamic threshold values from config
  const thresholds = getThresholds();
  
  // If multi-core is disabled, use the original single-core method
  if (!thresholds.ENABLE_MULTI_CORE) {
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
            HAMMING_THRESHOLD_UP: thresholds.HAMMING_THRESHOLD_UP,
            SSIM_THRESHOLD: thresholds.SSIM_THRESHOLD,
            PIXEL_CHANGE_RATIO_THRESHOLD: thresholds.PIXEL_CHANGE_RATIO_THRESHOLD,
            PIXEL_DIFF_THRESHOLD,
            SSIM_C1_FACTOR,
            SSIM_C2_FACTOR,
            VERIFICATION_COUNT: thresholds.VERIFICATION_COUNT,
            DEBUG_MODE,
            SIZE_IDENTICAL_THRESHOLD: thresholds.SIZE_IDENTICAL_THRESHOLD,
            SIZE_DIFF_THRESHOLD: thresholds.SIZE_DIFF_THRESHOLD
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
  
  // Get dynamic threshold values from config
  const thresholds = getThresholds();
  
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
      const comparisonResult = await compareImages(lastImageBuffer, currentImageBuffer, comparisonMethod, thresholds);
      
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
          } else if (currentVerification < thresholds.VERIFICATION_COUNT) {
            // Compare the current frame with the potential new frame
            const verificationResult = await compareImages(potentialNewImageBuffer, currentImageBuffer, comparisonMethod, thresholds);
            
            if (!verificationResult.changed) {
              // Frame identical, increase verification count
              currentVerification++;
              
              // Reached verification count, save the slide
              if (currentVerification >= thresholds.VERIFICATION_COUNT) {
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
        const verificationResult = await compareImages(potentialNewImageBuffer, currentImageBuffer, comparisonMethod, thresholds);
        
        if (!verificationResult.changed) {
          // Frame identical, increase verification count
          currentVerification++;
          
          // Reached verification count, save the slide
          if (currentVerification >= thresholds.VERIFICATION_COUNT) {
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
          if (!comparisonResult.changed && currentVerification >= thresholds.VERIFICATION_COUNT - 1) {
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

// Cache for preprocessed images to avoid redundant calculations
const preprocessCache = new Map();

// Compare two images using our new native image processor
async function compareImages(buffer1, buffer2, method = 'default', thresholds = null) {
  // Use default thresholds if none provided
  if (!thresholds) {
    thresholds = getThresholds();
  }
  
  try {
    // Add file size comparison as initial screening
    const sizeDifference = Math.abs(buffer1.length - buffer2.length);
    const sizeRatio = sizeDifference / Math.max(buffer1.length, buffer2.length);
    
    // If the file sizes are extremely similar (difference less than the threshold), directly determine them as the same image.
    if (sizeRatio < thresholds.SIZE_IDENTICAL_THRESHOLD) {
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
    if (sizeRatio > thresholds.SIZE_DIFF_THRESHOLD) {
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
        return await performBasicComparison(img1, img2, metadata1, metadata2, preprocessedData, thresholds);
      case 'default':
      default:
        return await performPerceptualComparison(img1, img2, metadata1, metadata2, preprocessedData, thresholds);
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
    // Create image processor instead of using Sharp
    const imageProcessor = createImageProcessor(buffer1);
    const metadata1 = await imageProcessor.getMetadata();
    
    // Common preprocessing for both pHash and SSIM
    const gray1 = await imageProcessor.toGrayscale();
    
    // Prepare different sizes for different algorithms
    const standard32 = await imageProcessor.resize(32, 32).toGrayscale();
    
    preprocessedImg1 = {
      img: imageProcessor,
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
    const imageProcessor = createImageProcessor(buffer2);
    const metadata2 = await imageProcessor.getMetadata();
    
    const gray2 = await imageProcessor.toGrayscale();
    const standard32 = await imageProcessor.resize(32, 32).toGrayscale();
    
    preprocessedImg2 = {
      img: imageProcessor,
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
async function performBasicComparison(img1, img2, metadata1, metadata2, preprocessedData, thresholds) {
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
        .resize(width, height)
        .blur(0.5) // Apply light blur for noise reduction
        .toGrayscale();
        
      gray2 = await img2
        .resize(width, height)
        .blur(0.5)
        .toGrayscale();
    }
    
    // Compare pixels
    const totalPixels = gray1.length;
    let diffCount = 0;
    
    for (let i = 0; i < totalPixels; i++) {
      const diff = Math.abs(gray1[i] - gray2[i]);
      if (diff > PIXEL_DIFF_THRESHOLD) {
        diffCount++;
      }
    }
    
    const changeRatio = diffCount / totalPixels;
    
    return {
      changed: changeRatio > thresholds.PIXEL_CHANGE_RATIO_THRESHOLD,
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
async function performPerceptualComparison(img1, img2, metadata1, metadata2, preprocessedData, thresholds) {
  try {
    // Calculate perceptual hash using preprocessed data
    const hash1 = await calculatePerceptualHash(img1, preprocessedData.standard32_1);
    const hash2 = await calculatePerceptualHash(img2, preprocessedData.standard32_2);
    
    // Calculate Hamming distance
    const hammingDistance = calculateHammingDistance(hash1, hash2);
    
    if (DEBUG_MODE) {
      console.log(`pHash comparison: Hamming distance = ${hammingDistance}`);
    }
    
    if (hammingDistance > thresholds.HAMMING_THRESHOLD_UP) {
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
        changed: ssim < thresholds.SSIM_THRESHOLD,
        changeRatio: 1.0 - ssim,
        method: 'SSIM-like',
        similarity: ssim
      };
    }
  } catch (error) {
    console.error('Perceptual comparison error:', error);
    // Fall back to basic method
    return performBasicComparison(img1, img2, metadata1, metadata2, preprocessedData, thresholds);
  }
}

// Calculate perceptual hash
async function calculatePerceptualHash(img, preprocessedData) {
  try {
    // Use preprocessed 32x32 grayscale data if available
    const data = preprocessedData || await img.resize(32, 32).toGrayscale();
    
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
    let binaryHash = '';
    for (let y = 0; y < hashSize; y++) {
      for (let x = 0; x < hashSize; x++) {
        if (!(x === 0 && y === 0)) {
          binaryHash += (dct[y][x] >= medianValue) ? '1' : '0';
        }
      }
    }
    
    // Convert binary hash to hexadecimal format (like reference software)
    // Ensure 64-bit hash by padding if needed
    const paddedBinary = binaryHash.padEnd(64, '0');
    let hexHash = '';
    for (let i = 0; i < paddedBinary.length; i += 4) {
      const chunk = paddedBinary.substr(i, 4);
      const hexDigit = parseInt(chunk, 2).toString(16);
      hexHash += hexDigit;
    }
    
    return hexHash;
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
  
  // Convert hex hashes back to binary for bit-wise comparison
  let binary1 = '';
  let binary2 = '';
  
  for (let i = 0; i < hash1.length; i++) {
    const digit1 = parseInt(hash1[i], 16).toString(2).padStart(4, '0');
    const digit2 = parseInt(hash2[i], 16).toString(2).padStart(4, '0');
    binary1 += digit1;
    binary2 += digit2;
  }
  
  // Calculate bit differences
  let distance = 0;
  for (let i = 0; i < binary1.length; i++) {
    if (binary1[i] !== binary2[i]) {
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
      gray1 = await img1.resize(width, height).toGrayscale();
      gray2 = await img2.resize(width, height).toGrayscale();
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

// Get preset fingerprints information
ipcMain.handle('get-preset-fingerprints-info', async () => {
  return new Promise((resolve, reject) => {
    try {
      const presetDir = getPresetFingerprintsDir();
      const currentVersion = getPresetVersion();
      
      let presetFiles = [];
      let dirExists = false;
      
      if (fs.existsSync(presetDir)) {
        dirExists = true;
        presetFiles = fs.readdirSync(presetDir)
          .filter(file => file.endsWith('.fp'))
          .map(file => ({
            filename: file,
            name: path.basename(file, '.fp'),
            fullPath: path.join(presetDir, file)
          }));
      }
      
      // Get version file info
      const versionFile = path.join(fingerprintStorageDir, 'preset_version.txt');
      let installedVersion = '0';
      if (fs.existsSync(versionFile)) {
        installedVersion = fs.readFileSync(versionFile, 'utf8').trim();
      }
      
      resolve({
        success: true,
        presetDir,
        dirExists,
        presetFiles,
        currentVersion,
        installedVersion,
        needsUpdate: installedVersion !== currentVersion
      });
    } catch (error) {
      reject(`Error getting preset fingerprints info: ${error.message}`);
    }
  });
});

// Get preset configuration for debugging
ipcMain.handle('get-preset-config', async () => {
  return new Promise((resolve, reject) => {
    try {
      const presetConfig = loadPresetConfig();
      const presetDir = getPresetFingerprintsDir();
      const configPath = path.join(presetDir, 'presets.json');
      
      resolve({
        success: true,
        config: presetConfig,
        configPath,
        configExists: fs.existsSync(configPath)
      });
    } catch (error) {
      reject(`Error getting preset config: ${error.message}`);
    }
  });
});

// Get detailed fingerprint information including region configuration
ipcMain.handle('get-fingerprint-details', async (event, id) => {
  return new Promise(async (resolve, reject) => {
    try {
      const index = loadFingerprintIndex();
      const metadata = index.fingerprints[id];
      
      if (!metadata) {
        reject(`Fingerprint with ID '${id}' not found`);
        return;
      }
      
      // Load the actual fingerprint data
      const fingerprintData = await loadFingerprintById(id);
      
      // Check if this is a preset fingerprint
      const isPreset = id.startsWith('preset_') || (metadata.fingerprint && metadata.fingerprint.preset);
      
      // Get region configuration from metadata
      const regionConfig = metadata.fingerprint?.regionConfig || null;
      
      resolve({
        success: true,
        id,
        metadata,
        fingerprint: fingerprintData.fingerprint,
        isPreset,
        regionConfig,
        hasRegionConfig: !!(regionConfig && regionConfig.enabled),
        details: {
          name: metadata.name,
          threshold: metadata.threshold,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          fileSize: metadata.size,
          blockCount: fingerprintData.fingerprint.blocks?.length || 0,
          version: fingerprintData.fingerprint.version || 1
        }
      });
    } catch (error) {
      reject(`Error getting fingerprint details: ${error.message}`);
    }
  });
});


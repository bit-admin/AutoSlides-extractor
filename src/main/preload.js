const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  
  getVideoInfo: (videoPath) => ipcRenderer.invoke('get-video-info', videoPath),
  extractFrames: (options) => {
    // Remove the callback function because function objects cannot be serialized and cloned.
    const serializableOptions = { ...options };
    delete serializableOptions.onProgress;
    
    // Set progress callback
    ipcRenderer.on('extraction-progress', (event, progress) => {
      if (typeof options.onProgress === 'function') {
        options.onProgress(progress);
      }
    });
    
    return ipcRenderer.invoke('extract-frames', serializableOptions);
  },

  cancelExtraction: () => ipcRenderer.invoke('cancel-extraction'),
  
  saveSlide: (options) => ipcRenderer.invoke('save-slide', options),
  
  listFrameFiles: (dirPath) => ipcRenderer.invoke('list-frame-files', dirPath),
  readFrameImage: (filePath) => ipcRenderer.invoke('read-frame-image', filePath),
  createSlidesDir: (baseDir) => ipcRenderer.invoke('create-slides-dir', baseDir),
  cleanupTempDir: (tempDir) => ipcRenderer.invoke('cleanup-temp-dir', tempDir),
  
  // New method for analyzing frames in the main process
  analyzeFrames: (options) => {
    // Setup event listeners for progress and slide extraction
    ipcRenderer.on('analysis-progress', (event, progress) => {
      if (typeof options.onProgress === 'function') {
        options.onProgress(progress);
      }
    });
    
    ipcRenderer.on('slide-extracted', (event, slideInfo) => {
      if (typeof options.onSlideExtracted === 'function') {
        options.onSlideExtracted(slideInfo);
      }
    });
    
    // Prepare serializable options
    const serializableOptions = { ...options };
    delete serializableOptions.onProgress;
    delete serializableOptions.onSlideExtracted;
    
    return ipcRenderer.invoke('analyze-frames', serializableOptions);
  },
  
  // Remove all listeners
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('extraction-progress');
    ipcRenderer.removeAllListeners('analysis-progress');
    ipcRenderer.removeAllListeners('slide-extracted');
  },

  // Post-processing methods
  calculateImageHash: (imagePath) => ipcRenderer.invoke('calculate-image-hash', imagePath),
  postProcessSlides: (slidesDir, excludeHashes) => ipcRenderer.invoke('post-process-slides', { slidesDir, excludeHashes }),
  selectImageFile: () => ipcRenderer.invoke('select-image-file'),
  selectSlidesDir: () => ipcRenderer.invoke('select-slides-dir')
});
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
  
  // Remove all listeners
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('extraction-progress');
  }
});
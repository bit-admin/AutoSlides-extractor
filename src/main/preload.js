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
  postProcessSlides: (slidesDir, excludeFingerprints) => ipcRenderer.invoke('post-process-slides', { slidesDir, excludeFingerprints }),
  selectImageFile: () => ipcRenderer.invoke('select-image-file'),
  selectSlidesDir: () => ipcRenderer.invoke('select-slides-dir'),
  
  // SSIM fingerprint methods
  calculateImageSSIMFingerprint: (options) => ipcRenderer.invoke('calculate-image-ssim-fingerprint', options),
  compareSSIMFingerprints: (options) => ipcRenderer.invoke('compare-ssim-fingerprints', options),
  storeImageFingerprint: (options) => ipcRenderer.invoke('store-image-fingerprint', options),
  loadFingerprintById: (id) => ipcRenderer.invoke('load-fingerprint-by-id', id),
  getAllFingerprints: () => ipcRenderer.invoke('get-all-fingerprints'),
  getExcludeFingerprints: () => ipcRenderer.invoke('get-exclude-fingerprints'),
  updateFingerprint: (options) => ipcRenderer.invoke('update-fingerprint', options),
  deleteFingerprintById: (id) => ipcRenderer.invoke('delete-fingerprint-by-id', id),
  addFingerprintToExcludes: (options) => ipcRenderer.invoke('add-fingerprint-to-excludes', options),
  removeFingerprintFromExcludes: (id) => ipcRenderer.invoke('remove-fingerprint-from-excludes', id),
  exportFingerprint: (options) => ipcRenderer.invoke('export-fingerprint', options),
  importFingerprint: (options) => ipcRenderer.invoke('import-fingerprint', options),
  openFingerprintStorageDir: () => ipcRenderer.invoke('open-fingerprint-storage-dir'),
  getPresetFingerprintsInfo: () => ipcRenderer.invoke('get-preset-fingerprints-info'),
  getPresetConfig: () => ipcRenderer.invoke('get-preset-config'),
  
  // Region-based comparison methods
  getRegionAlignmentTypes: () => ipcRenderer.invoke('get-region-alignment-types'),
  calculateRegionBounds: (options) => ipcRenderer.invoke('calculate-region-bounds', options),
  testRegionFingerprintSimilarity: (options) => ipcRenderer.invoke('test-region-fingerprint-similarity', options),
  testFingerprintSimilarity: (options) => ipcRenderer.invoke('test-fingerprint-similarity', options),
  storeImageFingerprintWithRegion: (options) => ipcRenderer.invoke('store-image-fingerprint-with-region', options)
});
const { contextBridge, ipcRenderer } = require('electron');

// 在window对象上暴露API给渲染进程使用
contextBridge.exposeInMainWorld('electronAPI', {
  // 配置相关
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  
  // 文件选择
  selectOutputDir: () => ipcRenderer.invoke('select-output-dir'),
  selectVideoFile: () => ipcRenderer.invoke('select-video-file'),
  
  // 视频处理
  getVideoInfo: (videoPath) => ipcRenderer.invoke('get-video-info', videoPath),
  extractFrames: (options) => {
    // 移除回调函数，因为函数对象不能被序列化和克隆
    const serializableOptions = { ...options };
    delete serializableOptions.onProgress;
    
    // 设置进度回调
    ipcRenderer.on('extraction-progress', (event, progress) => {
      if (typeof options.onProgress === 'function') {
        options.onProgress(progress);
      }
    });
    
    return ipcRenderer.invoke('extract-frames', serializableOptions);
  },
  
  // 图像保存
  saveSlide: (options) => ipcRenderer.invoke('save-slide', options),
  
  // 文件系统操作 - 添加新的API接口
  listFrameFiles: (dirPath) => ipcRenderer.invoke('list-frame-files', dirPath),
  readFrameImage: (filePath) => ipcRenderer.invoke('read-frame-image', filePath),
  createSlidesDir: (baseDir) => ipcRenderer.invoke('create-slides-dir', baseDir),
  cleanupTempDir: (tempDir) => ipcRenderer.invoke('cleanup-temp-dir', tempDir),
  
  // 移除所有监听器
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('extraction-progress');
  }
});
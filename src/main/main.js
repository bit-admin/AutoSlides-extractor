const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

// 设置ffmpeg和ffprobe路径
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

// 保持对窗口对象的全局引用，避免JavaScript对象被垃圾回收时窗口关闭
let mainWindow;

// 创建配置文件路径
const userDataPath = app.getPath('userData');
const configPath = path.join(userDataPath, 'config.json');

// 默认配置
const defaultConfig = {
  outputDir: app.getPath('pictures'),
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

// 加载配置
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

// 保存配置
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
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  });

  // 加载应用的index.html
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // 打开开发者工具
  mainWindow.webContents.openDevTools();

  // 当窗口关闭时触发
  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

// 当Electron完成初始化并准备创建浏览器窗口时调用此方法
app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    // 在macOS上，当点击dock图标并且没有其他窗口打开时，通常会在应用程序中重新创建一个窗口
    if (mainWindow === null) createWindow();
  });
});

// 当所有窗口关闭时退出应用
app.on('window-all-closed', function () {
  // 在macOS上，除非用户使用Cmd + Q确定地退出，否则应用和菜单栏会保持活动状态
  if (process.platform !== 'darwin') app.quit();
});

// 处理IPC消息

// 获取配置
ipcMain.handle('get-config', () => {
  return loadConfig();
});

// 保存配置
ipcMain.handle('save-config', (event, config) => {
  return saveConfig(config);
});

// 选择输出目录
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

// 选择视频文件
ipcMain.handle('select-video-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Video Files', extensions: ['mp4', 'avi', 'mkv', 'mov', 'webm'] }
    ]
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// 获取视频信息
ipcMain.handle('get-video-info', async (event, videoPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err.message);
        return;
      }
      
      // 提取视频信息
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

// 处理视频抽帧
ipcMain.handle('extract-frames', async (event, { videoPath, outputDir, interval, onProgress }) => {
  return new Promise((resolve, reject) => {
    try {
      // 确保输出目录存在
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // 获取视频信息
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(err.message);
          return;
        }
        
        const duration = metadata.format.duration;
        const totalFrames = Math.floor(duration / interval);
        let processedFrames = 0;
        
        // 创建时间戳目录
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const framesDir = path.join(outputDir, `frames_${timestamp}`);
        if (!fs.existsSync(framesDir)) {
          fs.mkdirSync(framesDir, { recursive: true });
        }
        
        // 设置抽帧命令
        const command = ffmpeg(videoPath)
          .outputOptions([
            `-vf fps=1/${interval}`,  // 每隔interval秒抽取一帧
            '-q:v 1'                  // 最高质量
          ])
          .output(path.join(framesDir, 'frame-%04d.jpg'))
          .on('progress', (progress) => {
            // 计算进度
            const currentTime = progress.timemark.split(':');
            const seconds = parseInt(currentTime[0]) * 3600 + 
                          parseInt(currentTime[1]) * 60 + 
                          parseFloat(currentTime[2]);
            const percent = Math.min(100, Math.round((seconds / duration) * 100));
            
            // 通知渲染进程进度更新
            event.sender.send('extraction-progress', { percent, currentTime: seconds, totalTime: duration });
          })
          .on('end', () => {
            resolve({
              framesDir,
              totalFrames: Math.floor(duration / interval)
            });
          })
          .on('error', (err) => {
            reject(`Frame extraction error: ${err.message}`);
          });
        
        // 执行命令
        command.run();
      });
    } catch (error) {
      reject(`Video processing error: ${error.message}`);
    }
  });
});

// 保存幻灯片
ipcMain.handle('save-slide', async (event, { imageData, outputDir, filename }) => {
  return new Promise((resolve, reject) => {
    try {
      // 确保输出目录存在
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // 将Base64图像数据写入文件
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

// 列出帧文件
ipcMain.handle('list-frame-files', async (event, dirPath) => {
  return new Promise((resolve, reject) => {
    try {
      // 确保目录存在
      if (!fs.existsSync(dirPath)) {
        reject('Directory does not exist');
        return;
      }
      
      // 读取目录中的文件
      const files = fs.readdirSync(dirPath)
        .filter(file => file.endsWith('.jpg'))
        .sort((a, b) => {
          // 按帧号排序
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

// 读取帧图像
ipcMain.handle('read-frame-image', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    try {
      // 确保文件存在
      if (!fs.existsSync(filePath)) {
        reject('File does not exist');
        return;
      }
      
      // 读取文件
      const frameData = fs.readFileSync(filePath);
      const base64Data = `data:image/jpeg;base64,${frameData.toString('base64')}`;
      
      resolve(base64Data);
    } catch (error) {
      reject(`Error reading frame image: ${error.message}`);
    }
  });
});

// 创建幻灯片目录
ipcMain.handle('create-slides-dir', async (event, baseDir) => {
  return new Promise((resolve, reject) => {
    try {
      // 创建幻灯片输出目录
      const slidesDir = path.join(baseDir, 'slides_' + new Date().toISOString().replace(/[:.]/g, '-'));
      if (!fs.existsSync(slidesDir)) {
        fs.mkdirSync(slidesDir, { recursive: true });
      }
      
      resolve(slidesDir);
    } catch (error) {
      reject(`Error creating slides directory: ${error.message}`);
    }
  });
});
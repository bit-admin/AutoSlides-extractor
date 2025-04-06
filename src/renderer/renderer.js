// 获取DOM元素
const inputVideo = document.getElementById('inputVideo');
const inputOutputDir = document.getElementById('inputOutputDir');
const inputCheckInterval = document.getElementById('inputCheckInterval');
const btnSelectVideo = document.getElementById('btnSelectVideo');
const btnSelectDir = document.getElementById('btnSelectDir');
const btnStartProcess = document.getElementById('btnStartProcess');
const btnStopProcess = document.getElementById('btnStopProcess');
const progressBar = document.getElementById('progressBar');
const progressFill = progressBar.querySelector('.progress-fill');
const progressText = document.getElementById('progressText');
const statusText = document.getElementById('statusText');
const totalFrames = document.getElementById('totalFrames');
const extractedSlides = document.getElementById('extractedSlides');
const processingTime = document.getElementById('processingTime');
const slidesContainer = document.getElementById('slidesContainer');
const comparisonMethod = document.getElementById('comparisonMethod');
const hammingThresholdUp = document.getElementById('hammingThresholdUp');
const ssimThreshold = document.getElementById('ssimThreshold');
const enableDoubleVerification = document.getElementById('enableDoubleVerification');

// 全局变量
let selectedVideoPath = '';
let framesDir = '';
let isProcessing = false;
let processStartTime = 0;
let processedFrames = 0;
let extractedCount = 0;
let lastImageData = null;
let verificationCount = 2; // 二次校验需要的连续相同帧数
let currentVerification = 0;
let potentialNewImageData = null;

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 加载配置
  try {
    const config = await window.electronAPI.getConfig();
    inputOutputDir.value = config.outputDir || '';
    inputCheckInterval.value = config.checkInterval || 2;
    comparisonMethod.value = config.comparisonMethod || 'default';
    hammingThresholdUp.value = config.captureStrategy?.hammingThresholdUp || 5;
    ssimThreshold.value = config.captureStrategy?.ssimThreshold || 0.999;
    enableDoubleVerification.checked = config.enableDoubleVerification !== false;
  } catch (error) {
    console.error('加载配置失败:', error);
  }
});

// 事件监听器
btnSelectVideo.addEventListener('click', async () => {
  const videoPath = await window.electronAPI.selectVideoFile();
  if (videoPath) {
    selectedVideoPath = videoPath;
    inputVideo.value = videoPath;
    
    // 获取视频信息
    try {
      statusText.textContent = '正在获取视频信息...';
      const videoInfo = await window.electronAPI.getVideoInfo(videoPath);
      statusText.textContent = `视频信息: ${Math.round(videoInfo.duration)}秒, ${videoInfo.width}x${videoInfo.height}, ${videoInfo.fps.toFixed(2)}fps`;
    } catch (error) {
      statusText.textContent = `获取视频信息失败: ${error}`;
    }
  }
});

btnSelectDir.addEventListener('click', async () => {
  const outputDir = await window.electronAPI.selectOutputDir();
  if (outputDir) {
    inputOutputDir.value = outputDir;
  }
});

btnStartProcess.addEventListener('click', async () => {
  if (!selectedVideoPath) {
    statusText.textContent = '请先选择视频文件';
    return;
  }
  
  if (!inputOutputDir.value) {
    statusText.textContent = '请先选择输出目录';
    return;
  }
  
  // 保存配置
  await saveConfig();
  
  // 开始处理
  startProcessing();
});

btnStopProcess.addEventListener('click', () => {
  stopProcessing();
});

// 保存配置
async function saveConfig() {
  try {
    const config = {
      outputDir: inputOutputDir.value,
      checkInterval: parseFloat(inputCheckInterval.value),
      comparisonMethod: comparisonMethod.value,
      captureStrategy: {
        hammingThresholdUp: parseInt(hammingThresholdUp.value),
        ssimThreshold: parseFloat(ssimThreshold.value)
      },
      enableDoubleVerification: enableDoubleVerification.checked
    };
    
    await window.electronAPI.saveConfig(config);
  } catch (error) {
    console.error('保存配置失败:', error);
  }
}

// 开始处理视频
async function startProcessing() {
  try {
    isProcessing = true;
    processStartTime = Date.now();
    processedFrames = 0;
    extractedCount = 0;
    lastImageData = null;
    potentialNewImageData = null;
    currentVerification = 0;
    
    // 更新UI
    btnStartProcess.disabled = true;
    btnStopProcess.disabled = false;
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    totalFrames.textContent = '0';
    extractedSlides.textContent = '0';
    processingTime.textContent = '0秒';
    slidesContainer.innerHTML = '';
    statusText.textContent = '正在抽取视频帧...';
    
    // 抽取视频帧
    const interval = parseFloat(inputCheckInterval.value);
    
    // 移除之前可能存在的监听器
    window.electronAPI.removeAllListeners();
    
    const result = await window.electronAPI.extractFrames({
      videoPath: selectedVideoPath,
      outputDir: inputOutputDir.value,
      interval: interval,
      onProgress: updateProgress // 添加进度更新回调
    });
    
    framesDir = result.framesDir;
    totalFrames.textContent = result.totalFrames;
    
    // 处理抽取的帧
    statusText.textContent = '正在分析帧...';
    await processFrames(framesDir);
    
    // 完成处理
    const endTime = Date.now();
    const duration = Math.round((endTime - processStartTime) / 1000);
    processingTime.textContent = `${duration}秒`;
    statusText.textContent = `处理完成，共提取${extractedCount}张幻灯片`;
    
  } catch (error) {
    console.error('处理视频失败:', error);
    statusText.textContent = `处理失败: ${error}`;
  } finally {
    isProcessing = false;
    btnStartProcess.disabled = false;
    btnStopProcess.disabled = true;
  }
}

// 停止处理
function stopProcessing() {
  if (isProcessing) {
    isProcessing = false;
    statusText.textContent = '处理已停止';
    btnStartProcess.disabled = false;
    btnStopProcess.disabled = true;
  }
}

// 更新进度
function updateProgress(progress) {
  if (!isProcessing) return;
  
  const percent = progress.percent;
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
  statusText.textContent = `正在抽取视频帧... ${Math.round(progress.currentTime)}/${Math.round(progress.totalTime)}秒`;
}

// 处理抽取的帧
async function processFrames(framesDir) {
  try {
    // 获取所有帧文件 - 通过主进程API获取文件列表
    const result = await window.electronAPI.listFrameFiles(framesDir);
    const frameFiles = result.files;
    
    // 创建幻灯片输出目录
    const slidesDir = await window.electronAPI.createSlidesDir(inputOutputDir.value);
    
    // 处理每一帧
    for (let i = 0; i < frameFiles.length; i++) {
      if (!isProcessing) break; // 检查是否停止处理
      
      processedFrames++;
      const frameFile = frameFiles[i];
      // 使用完整路径，不再使用path.join
      const framePath = frameFiles[i].fullPath || `${framesDir}/${frameFile}`;
      
      // 更新进度
      const percent = Math.round((processedFrames / frameFiles.length) * 100);
      progressFill.style.width = `${percent}%`;
      progressText.textContent = `${percent}%`;
      statusText.textContent = `正在分析帧 ${processedFrames}/${frameFiles.length}`;
      
      // 读取帧图像 - 通过主进程API读取
      const base64Data = await window.electronAPI.readFrameImage(framePath);
      
      // 第一帧直接保存
      if (lastImageData === null) {
        lastImageData = base64Data;
        await saveSlide(base64Data, slidesDir, 'slide-001.jpg');
        extractedCount++;
        extractedSlides.textContent = extractedCount;
        continue;
      }
      
      // 比较当前帧与上一帧
      const comparisonResult = await compareImages(lastImageData, base64Data);
      
      // 如果检测到变化
      if (comparisonResult.changed) {
        console.log(`检测到变化: ${comparisonResult.method}, 变化率: ${comparisonResult.changeRatio.toFixed(4)}`);
        
        // 如果启用二次校验
        if (enableDoubleVerification.checked) {
          if (potentialNewImageData === null) {
            // 第一次检测到变化
            potentialNewImageData = base64Data;
            currentVerification = 1;
          } else if (currentVerification < verificationCount) {
            // 比较当前帧与潜在新帧
            const verificationResult = await compareImages(potentialNewImageData, base64Data);
            
            if (!verificationResult.changed) {
              // 帧相同，增加验证计数
              currentVerification++;
              
              // 达到验证次数，保存幻灯片
              if (currentVerification >= verificationCount) {
                lastImageData = potentialNewImageData;
                extractedCount++;
                const slideNumber = String(extractedCount).padStart(3, '0');
                await saveSlide(lastImageData, slidesDir, `slide-${slideNumber}.jpg`);
                extractedSlides.textContent = extractedCount;
                
                // 重置验证状态
                potentialNewImageData = null;
                currentVerification = 0;
              }
            } else {
              // 帧不同，更新潜在新帧
              potentialNewImageData = base64Data;
              currentVerification = 1;
            }
          }
        } else {
          // 不使用二次校验，直接保存
          lastImageData = base64Data;
          extractedCount++;
          const slideNumber = String(extractedCount).padStart(3, '0');
          await saveSlide(lastImageData, slidesDir, `slide-${slideNumber}.jpg`);
          extractedSlides.textContent = extractedCount;
        }
      } else if (potentialNewImageData !== null && enableDoubleVerification.checked) {
        // 比较当前帧与潜在新帧
        const verificationResult = await compareImages(potentialNewImageData, base64Data);
        
        if (!verificationResult.changed) {
          // 帧相同，增加验证计数
          currentVerification++;
          
          // 达到验证次数，保存幻灯片
          if (currentVerification >= verificationCount) {
            lastImageData = potentialNewImageData;
            extractedCount++;
            const slideNumber = String(extractedCount).padStart(3, '0');
            await saveSlide(lastImageData, slidesDir, `slide-${slideNumber}.jpg`);
            extractedSlides.textContent = extractedCount;
            
            // 重置验证状态
            potentialNewImageData = null;
            currentVerification = 0;
          }
        } else {
          // 帧不同，更新潜在新帧
          potentialNewImageData = base64Data;
          currentVerification = 1;
        }
      }
    }
    
    return extractedCount;
  } catch (error) {
    console.error('处理帧失败:', error);
    throw error;
  }
}

// 保存幻灯片
async function saveSlide(imageData, outputDir, filename) {
  try {
    // 保存到文件
    await window.electronAPI.saveSlide({
      imageData,
      outputDir,
      filename
    });
    
    // 添加到预览区域
    addSlidePreview(imageData, filename);
    
    return true;
  } catch (error) {
    console.error('保存幻灯片失败:', error);
    return false;
  }
}

// 添加幻灯片预览
function addSlidePreview(imageData, filename) {
  const slideItem = document.createElement('div');
  slideItem.className = 'slide-item';
  
  const img = document.createElement('img');
  img.src = imageData;
  img.alt = filename;
  
  const info = document.createElement('div');
  info.className = 'slide-info';
  info.textContent = filename;
  
  slideItem.appendChild(img);
  slideItem.appendChild(info);
  slidesContainer.appendChild(slideItem);
}

// 图像处理函数

// 比较两张图像
function compareImages(img1Data, img2Data) {
  return new Promise((resolve) => {
    const img1 = new Image();
    const img2 = new Image();
    let loadedCount = 0;
    
    function processImages() {
      if (loadedCount === 2) {
        const canvas1 = document.createElement('canvas');
        const canvas2 = document.createElement('canvas');
        const ctx1 = canvas1.getContext('2d');
        const ctx2 = canvas2.getContext('2d');
        
        canvas1.width = img1.width;
        canvas1.height = img1.height;
        canvas2.width = img2.width;
        canvas2.height = img2.height;
        
        ctx1.drawImage(img1, 0, 0);
        ctx2.drawImage(img2, 0, 0);
        
        // 获取图像数据
        const data1 = ctx1.getImageData(0, 0, canvas1.width, canvas1.height);
        const data2 = ctx2.getImageData(0, 0, canvas2.width, canvas2.height);
        
        // 获取比较方法
        const method = comparisonMethod.value || 'default';
        
        // 使用不同的比较策略
        switch (method) {
          case 'basic':
            performBasicComparison(data1, data2, resolve);
            break;
          case 'perceptual':
            performPerceptualComparison(data1, data2, resolve);
            break;
          default:
            performPerceptualComparison(data1, data2, resolve); // 默认使用感知哈希方法
        }
      }
    }
    
    img1.onload = () => {
      loadedCount++;
      processImages();
    };
    
    img2.onload = () => {
      loadedCount++;
      processImages();
    };
    
    img1.src = img1Data;
    img2.src = img2Data;
  });
}

// 基本像素比较
function performBasicComparison(data1, data2, resolve) {
  // 转换为灰度
  data1 = convertToGrayscale(data1);
  data2 = convertToGrayscale(data2);
  
  // 应用高斯模糊
  data1 = applyGaussianBlur(data1, 0.5);
  data2 = applyGaussianBlur(data2, 0.5);
  
  // 比较像素
  const comparisonResult = comparePixels(data1, data2);
  const changeRatioThreshold = 0.005; // 变化率阈值
  
  resolve({
    changed: comparisonResult.changeRatio > changeRatioThreshold,
    changeRatio: comparisonResult.changeRatio,
    method: 'basic'
  });
}

// 感知哈希比较
function performPerceptualComparison(data1, data2, resolve) {
  try {
    // 计算感知哈希
    const hash1 = calculatePerceptualHash(data1);
    const hash2 = calculatePerceptualHash(data2);
    
    // 计算汉明距离
    const hammingDistance = calculateHammingDistance(hash1, hash2);
    const hammingThreshold = parseInt(hammingThresholdUp.value) || 5;
    
    console.log(`pHash比较: 汉明距离 = ${hammingDistance}`);
    
    if (hammingDistance > hammingThreshold) {
      // 哈希显著不同
      resolve({
        changed: true,
        changeRatio: hammingDistance / 64, // 64位哈希
        method: 'pHash',
        distance: hammingDistance
      });
    } else if (hammingDistance === 0) {
      // 完全相同的哈希
      resolve({
        changed: false,
        changeRatio: 0,
        method: 'pHash',
        distance: 0
      });
    } else {
      // 边界情况，使用SSIM
      const ssim = calculateSSIM(data1, data2);
      const ssimThresholdValue = parseFloat(ssimThreshold.value) || 0.999;
      
      console.log(`SSIM相似度: ${ssim.toFixed(6)}`);
      
      resolve({
        changed: ssim < ssimThresholdValue,
        changeRatio: 1.0 - ssim,
        method: 'SSIM',
        similarity: ssim
      });
    }
  } catch (error) {
    console.error('感知比较错误:', error);
    performBasicComparison(data1, data2, resolve); // 回退到基本方法
  }
}

// 转换为灰度图像
function convertToGrayscale(imageData) {
  const data = new Uint8ClampedArray(imageData.data);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // 使用加权平均法计算灰度值
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    data[i] = data[i + 1] = data[i + 2] = gray;
  }
  return new ImageData(data, imageData.width, imageData.height);
}

// 应用高斯模糊
function applyGaussianBlur(imageData, sigma) {
  // 创建高斯核
  const kernelSize = Math.max(3, Math.ceil(sigma * 3) * 2 + 1);
  const halfSize = Math.floor(kernelSize / 2);
  const kernel = new Array(kernelSize);
  
  // 计算高斯核
  let sum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - halfSize;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  
  // 归一化
  for (let i = 0; i < kernelSize; i++) {
    kernel[i] /= sum;
  }
  
  // 创建临时图像数据
  const width = imageData.width;
  const height = imageData.height;
  const data = new Uint8ClampedArray(imageData.data);
  const temp = new Uint8ClampedArray(data);
  
  // 水平方向模糊
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      
      for (let i = 0; i < kernelSize; i++) {
        const kx = Math.min(width - 1, Math.max(0, x + i - halfSize));
        const idx = (y * width + kx) * 4;
        const weight = kernel[i];
        
        r += data[idx] * weight;
        g += data[idx + 1] * weight;
        b += data[idx + 2] * weight;
      }
      
      const idx = (y * width + x) * 4;
      temp[idx] = r;
      temp[idx + 1] = g;
      temp[idx + 2] = b;
      temp[idx + 3] = data[idx + 3]; // 保持alpha不变
    }
  }
  
  // 垂直方向模糊
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      
      for (let i = 0; i < kernelSize; i++) {
        const ky = Math.min(height - 1, Math.max(0, y + i - halfSize));
        const idx = (ky * width + x) * 4;
        const weight = kernel[i];
        
        r += temp[idx] * weight;
        g += temp[idx + 1] * weight;
        b += temp[idx + 2] * weight;
      }
      
      const idx = (y * width + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      // Alpha保持不变
    }
  }
  
  return new ImageData(data, width, height);
}

// 比较像素
function comparePixels(data1, data2) {
  const width = Math.min(data1.width, data2.width);
  const height = Math.min(data1.height, data2.height);
  const totalPixels = width * height;
  let diffCount = 0;
  
  // 计算像素差异
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const diff = Math.abs(data1.data[i] - data2.data[i]);
      
      if (diff > 30) { // 像素差异阈值
        diffCount++;
      }
    }
  }
  
  const changeRatio = diffCount / totalPixels;
  
  return {
    diffCount,
    totalPixels,
    changeRatio
  };
}

// 调整图像大小
function resizeImageData(imageData, newWidth, newHeight) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  // 创建临时图像
  const img = new Image();
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  
  // 设置临时画布为原始图像大小
  tempCanvas.width = imageData.width;
  tempCanvas.height = imageData.height;
  
  // 创建ImageData并放到临时画布上
  tempCtx.putImageData(imageData, 0, 0);
  
  // 设置目标画布大小
  canvas.width = newWidth;
  canvas.height = newHeight;
  
  // 将调整大小后的图像绘制到目标画布
  ctx.drawImage(tempCanvas, 0, 0, imageData.width, imageData.height, 0, 0, newWidth, newHeight);
  
  // 返回新的ImageData
  return ctx.getImageData(0, 0, newWidth, newHeight);
}

// 计算感知哈希
function calculatePerceptualHash(imageData) {
  // 转换为灰度
  const grayscaleData = convertToGrayscale(imageData);
  
  // 调整为32x32用于DCT处理
  const resizedData = resizeImageData(grayscaleData, 32, 32);
  
  // 将图像数据转换为2D数组用于DCT
  const pixels = new Array(32);
  for (let y = 0; y < 32; y++) {
    pixels[y] = new Array(32);
    for (let x = 0; x < 32; x++) {
      const idx = (y * 32 + x) * 4;
      pixels[y][x] = resizedData.data[idx]; // 使用红色通道（灰度）
    }
  }
  
  // 应用DCT - 简化版本
  const dct = applySimplifiedDCT(pixels, 32);
  
  // 计算低频分量的中值（不包括DC分量）
  // 我们将使用DCT系数的较小部分（8x8低频分量）
  const hashSize = 8;
  const dctLowFreq = [];
  for (let y = 0; y < hashSize; y++) {
    for (let x = 0; x < hashSize; x++) {
      if (!(x === 0 && y === 0)) { // 跳过DC分量（左上角）
        dctLowFreq.push(dct[y][x]);
      }
    }
  }
  dctLowFreq.sort((a, b) => a - b);
  const medianValue = dctLowFreq[Math.floor(dctLowFreq.length / 2)];
  
  // 使用低频分量生成哈希
  let hash = '';
  for (let y = 0; y < hashSize; y++) {
    for (let x = 0; x < hashSize; x++) {
      if (!(x === 0 && y === 0)) { // 跳过DC分量
        hash += (dct[y][x] >= medianValue) ? '1' : '0';
      }
    }
  }
  
  return hash;
}

// 应用简化的DCT
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
      
      // 应用权重因子
      const cu = (u === 0) ? 1 / Math.sqrt(2) : 1;
      const cv = (v === 0) ? 1 / Math.sqrt(2) : 1;
      result[u][v] = sum * cu * cv * (2 / size);
    }
  }
  
  return result;
}

// 计算汉明距离
function calculateHammingDistance(hash1, hash2) {
  if (hash1.length !== hash2.length) {
    throw new Error('哈希长度不匹配');
  }
  
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] !== hash2[i]) {
      distance++;
    }
  }
  
  return distance;
}

// 计算SSIM (结构相似性指数)
function calculateSSIM(img1Data, img2Data) {
  // 转换为灰度
  const gray1 = convertToGrayscale(img1Data);
  const gray2 = convertToGrayscale(img2Data);
  
  // 计算均值
  let mean1 = 0, mean2 = 0;
  const pixelCount = gray1.width * gray1.height;
  
  for (let i = 0; i < gray1.data.length; i += 4) {
    mean1 += gray1.data[i];
    mean2 += gray2.data[i];
  }
  mean1 /= pixelCount;
  mean2 /= pixelCount;
  
  // 计算方差和协方差
  let var1 = 0, var2 = 0, covar = 0;
  for (let i = 0; i < gray1.data.length; i += 4) {
    const diff1 = gray1.data[i] - mean1;
    const diff2 = gray2.data[i] - mean2;
    var1 += diff1 * diff1;
    var2 += diff2 * diff2;
    covar += diff1 * diff2;
  }
  var1 /= pixelCount;
  var2 /= pixelCount;
  covar /= pixelCount;
  
  // 稳定常数
  const C1 = 0.01 * 255 * 0.01 * 255;
  const C2 = 0.03 * 255 * 0.03 * 255;
  
  // 计算SSIM
  const numerator = (2 * mean1 * mean2 + C1) * (2 * covar + C2);
  const denominator = (mean1 * mean1 + mean2 * mean2 + C1) * (var1 + var2 + C2);
  
  return numerator / denominator;
}
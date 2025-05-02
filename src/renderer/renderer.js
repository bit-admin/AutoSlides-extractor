// Get DOM element
const inputVideo = document.getElementById('inputVideo');
const inputOutputDir = document.getElementById('inputOutputDir');
const inputCheckInterval = document.getElementById('inputCheckInterval');
const btnSelectVideo = document.getElementById('btnSelectVideo');
const btnSelectDir = document.getElementById('btnSelectDir');
const btnStartProcess = document.getElementById('btnStartProcess');
const btnStopProcess = document.getElementById('btnStopProcess');
const btnReset = document.getElementById('btnReset');
const progressBar = document.getElementById('progressBar');
const progressFill = progressBar.querySelector('.progress-fill');
const progressText = document.getElementById('progressText');
const statusText = document.getElementById('statusText');
const totalFrames = document.getElementById('totalFrames');
const extractedSlides = document.getElementById('extractedSlides');
const processingTime = document.getElementById('processingTime');
const slidesContainer = document.getElementById('slidesContainer');
const comparisonMethod = document.getElementById('comparisonMethod');
const enableDoubleVerification = document.getElementById('enableDoubleVerification');

// Global variable
let selectedVideoPath = '';
let framesDir = '';
let isProcessing = false;
let processStartTime = 0;
let processedFrames = 0;
let extractedCount = 0;
let timerInterval = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Load configuration
  try {
    const config = await window.electronAPI.getConfig();
    inputOutputDir.value = config.outputDir || '';
    inputCheckInterval.value = config.checkInterval || 2;
    comparisonMethod.value = config.comparisonMethod || 'default';
    enableDoubleVerification.checked = config.enableDoubleVerification !== false;
  } catch (error) {
    console.error('Failed to load configuration:', error);
  }
});

// Event Listener
btnSelectVideo.addEventListener('click', async () => {
  const videoPath = await window.electronAPI.selectVideoFile();
  if (videoPath) {
    selectedVideoPath = videoPath;
    inputVideo.value = videoPath;
    
    // Get video information
    try {
      statusText.textContent = 'Getting video information...';
      const videoInfo = await window.electronAPI.getVideoInfo(videoPath);
      statusText.textContent = `Video info: ${Math.round(videoInfo.duration)}s, ${videoInfo.width}x${videoInfo.height}, ${videoInfo.fps.toFixed(2)}fps`;
    } catch (error) {
      statusText.textContent = `Failed to get video information: ${error}`;
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
    statusText.textContent = 'Please select a video file first';
    return;
  }
  
  if (!inputOutputDir.value) {
    statusText.textContent = 'Please select an output directory first';
    return;
  }
  
  // Save configuration
  await saveConfig();
  
  // Start processing
  startProcessing();
});

btnStopProcess.addEventListener('click', () => {
  stopProcessing();
});

btnReset.addEventListener('click', () => {
  resetUI();
});

// Save configuration
async function saveConfig() {
  try {
    const config = {
      outputDir: inputOutputDir.value,
      checkInterval: parseFloat(inputCheckInterval.value),
      comparisonMethod: comparisonMethod.value,
      enableDoubleVerification: enableDoubleVerification.checked
    };
    
    await window.electronAPI.saveConfig(config);
  } catch (error) {
    console.error('Failed to save configuration:', error);
  }
}

// Start processing video
async function startProcessing() {
  let tempDir = null; // Move declaration here to make it accessible in finally block
  
  try {
    isProcessing = true;
    processStartTime = Date.now();
    processedFrames = 0;
    extractedCount = 0;
    
    // Update UI
    btnStartProcess.disabled = true;
    btnStopProcess.disabled = false;
    btnReset.disabled = true; // Disable Reset button during processing
    progressFill.style.width = '0%';
    progressText.textContent = '0%';
    totalFrames.textContent = '0';
    extractedSlides.textContent = '0';
    processingTime.textContent = '0s';
    slidesContainer.innerHTML = '';
    statusText.textContent = 'Extracting video frames...';
    
    // Start real-time timer
    startTimer();
    
    // Remove any existing listeners
    window.electronAPI.removeAllListeners();
    
    // Extract video frames
    const interval = parseFloat(inputCheckInterval.value);
    const result = await window.electronAPI.extractFrames({
      videoPath: selectedVideoPath,
      outputDir: inputOutputDir.value,
      interval: interval,
      saveFrames: false, // Do not save intermediate frame files
      onProgress: updateProgress // Add progress update callback
    });
    
    framesDir = result.framesDir;
    tempDir = result.tempDir; // Save the temporary directory path for subsequent cleanup
    totalFrames.textContent = result.totalFrames;
    
    // Process the extracted frames in main process
    statusText.textContent = 'Analyzing frames...';
    
    const analysisResult = await window.electronAPI.analyzeFrames({
      framesDir,
      outputDir: inputOutputDir.value,
      comparisonMethod: comparisonMethod.value,
      enableDoubleVerification: enableDoubleVerification.checked,
      onProgress: updateAnalysisProgress,
      onSlideExtracted: handleSlideExtracted
    });
    
    if (analysisResult.success) {
      extractedCount = analysisResult.extractedCount;
      extractedSlides.textContent = extractedCount;
      
      // Complete processing
      stopTimer(); // Stop the timer
      statusText.textContent = `Processing complete, extracted ${extractedCount} slides`;
    } else {
      throw new Error(analysisResult.error || 'Unknown error during analysis');
    }
    
  } catch (error) {
    console.error('Failed to process video:', error);
    
    // Check if this was a manual stop (don't show error in that case)
    if (!isProcessing && error.message && error.message.includes('killed with signal SIGKILL')) {
      statusText.textContent = 'Processing stopped';
    } else {
      statusText.textContent = `Processing failed: ${error}`;
    }
  } finally {
    isProcessing = false;
    btnStartProcess.disabled = false;
    btnStopProcess.disabled = true;
    btnReset.disabled = false; // Re-enable Reset button when processing ends

    // Clear temporary directory
    if (tempDir) {
      try {
        await window.electronAPI.cleanupTempDir(tempDir);
      } catch (cleanupError) {
        console.error('Failed to cleanup temporary directory:', cleanupError);
      }
    }
  }
}

// Stop processing
async function stopProcessing() {
  if (isProcessing) {
    isProcessing = false;
    statusText.textContent = 'Stopping processing...';
    
    // Cancel the ffmpeg process
    try {
      await window.electronAPI.cancelExtraction();
      statusText.textContent = 'Processing stopped';
    } catch (error) {
      console.error('Failed to stop processing:', error);
      statusText.textContent = 'Failed to stop processing';
    }
    
    btnStartProcess.disabled = false;
    btnStopProcess.disabled = true;
    btnReset.disabled = false; // Re-enable Reset button when processing is stopped
    stopTimer();
  }
}

// Reset UI
function resetUI() {
  // Reset progress bar
  progressFill.style.width = '0%';
  progressText.textContent = '0%';
  
  // Reset statistics data
  totalFrames.textContent = '0';
  extractedSlides.textContent = '0';
  processingTime.textContent = '0s';
  
  // Clear slide preview
  slidesContainer.innerHTML = '';
  
  // Reset state text
  statusText.textContent = 'Ready';
  
  // Clear video path
  selectedVideoPath = '';
  inputVideo.value = '';
}

// Start timer
function startTimer() {
  // Clear any existing old timers
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  // Set a new timer, updating every second
  timerInterval = setInterval(() => {
    if (isProcessing) {
      const currentTime = Date.now();
      const elapsedSeconds = Math.round((currentTime - processStartTime) / 1000);
      processingTime.textContent = `${elapsedSeconds}s`;
    }
  }, 1000);
}

// Stop the timer
function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

// Update progress for frame extraction
function updateProgress(progress) {
  if (!isProcessing) return;
  
  const percent = progress.percent;
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
  statusText.textContent = `Extracting video frames... ${Math.round(progress.currentTime)}/${Math.round(progress.totalTime)}s`;
}

// Update progress for frame analysis
function updateAnalysisProgress(progress) {
  if (!isProcessing) return;
  
  const percent = progress.percent;
  progressFill.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
  processedFrames = progress.processedFrames;
  statusText.textContent = `Analyzing frame ${progress.processedFrames}/${progress.totalFrames}`;
}

// Handle extracted slide notification
async function handleSlideExtracted(slideInfo) {
  if (!isProcessing) return;
  
  extractedCount++;
  extractedSlides.textContent = extractedCount;
  
  try {
    // Get the slide image to display in UI
    const imageData = await window.electronAPI.readFrameImage(slideInfo.slidePath);
    addSlidePreview(imageData, slideInfo.slideFilename);
  } catch (error) {
    console.error('Failed to load slide preview:', error);
  }
}

// Add slide preview
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
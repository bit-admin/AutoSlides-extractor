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

// Queue elements
const queueSection = document.getElementById('queueSection');
const queueList = document.getElementById('queueList');

// Advanced settings elements
const btnAdvancedSettings = document.getElementById('btnAdvancedSettings');
const advancedSettingsModal = document.getElementById('advancedSettingsModal');
const btnCloseAdvanced = document.getElementById('btnCloseAdvanced');
const btnSaveAdvanced = document.getElementById('btnSaveAdvanced');
const btnCancelAdvanced = document.getElementById('btnCancelAdvanced');

// Advanced threshold settings elements
const enableMultiCore = document.getElementById('enableMultiCore');
const hammingThreshold = document.getElementById('hammingThreshold');
const ssimThreshold = document.getElementById('ssimThreshold');
const pixelChangeRatioThreshold = document.getElementById('pixelChangeRatioThreshold');
const verificationCount = document.getElementById('verificationCount');
const sizeIdenticalThreshold = document.getElementById('sizeIdenticalThreshold');
const sizeDiffThreshold = document.getElementById('sizeDiffThreshold');

// Global variable
let selectedVideoPath = '';
let videoQueue = []; // Video queue
let isQueueProcessing = false; // Queue processing status
let currentQueueIndex = 0; // Current processing index in queue
let framesDir = '';
let isProcessing = false;
let processStartTime = 0;
let processedFrames = 0;
let extractedCount = 0;
let timerInterval = null;

// Progress Control Related Variables
let currentPhase = ''; // 'extracting' or 'analyzing'
let extractionWeight = 0.7; // The frame extraction phase accounts for 70% of the total progress.
let analyzingWeight = 0.3; // The analysis phase accounts for 30% of the total progress.
let extractionProgress = 0; // Frame extraction stage progress (0-100)
let analyzingProgress = 0;  // Analysis Phase Progress (0-100)
let totalActiveWorkers = 0; // Total number of active worker threads

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Load configuration
  try {
    const config = await window.electronAPI.getConfig();
    inputOutputDir.value = config.outputDir || '';
    inputCheckInterval.value = config.checkInterval || 2;
    comparisonMethod.value = config.comparisonMethod || 'default';
    enableDoubleVerification.checked = config.enableDoubleVerification !== false;
    
    // Load threshold settings
    enableMultiCore.checked = config.enableMultiCore !== false;
    hammingThreshold.value = config.hammingThreshold || 30;
    ssimThreshold.value = config.ssimThreshold || 0.95;
    pixelChangeRatioThreshold.value = config.pixelChangeRatioThreshold || 0.05;
    verificationCount.value = config.verificationCount || 3;
    sizeIdenticalThreshold.value = config.sizeIdenticalThreshold || 0.99;
    sizeDiffThreshold.value = config.sizeDiffThreshold || 0.1;
  } catch (error) {
    console.error('Failed to load configuration:', error);
  }
});

// Event Listener
btnSelectVideo.addEventListener('click', async () => {
  const videoPaths = await window.electronAPI.selectVideoFile();
  if (videoPaths && videoPaths.length > 0) {
    if (videoPaths.length === 1) {
      // Single file selected - use original logic
      selectedVideoPath = videoPaths[0];
      inputVideo.value = videoPaths[0];
      hideQueueSection();
      
      // Get video information
      try {
        statusText.textContent = 'Getting video information...';
        const videoInfo = await window.electronAPI.getVideoInfo(videoPaths[0]);
        statusText.textContent = `Video info: ${Math.round(videoInfo.duration)}s, ${videoInfo.width}x${videoInfo.height}, ${videoInfo.fps.toFixed(2)}fps`;
      } catch (error) {
        statusText.textContent = `Failed to get video information: ${error}`;
      }
    } else {
      // Multiple files selected - show queue
      videoQueue = videoPaths.map((path, index) => ({
        id: Date.now() + index,
        path: path,
        name: path.split('/').pop(),
        status: 'pending' // pending, processing, completed, error
      }));
      
      inputVideo.value = `${videoPaths.length} videos selected`;
      showQueueSection();
      updateQueueDisplay();
      selectedVideoPath = ''; // Clear single video selection
      statusText.textContent = `${videoPaths.length} videos added to queue`;
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
  // Check if we're in queue mode
  if (videoQueue.length > 0) {
    // Start queue processing
    startQueueProcessing();
    return;
  }
  
  // Single video processing
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
  // If queue is active, clear the queue
  if (videoQueue.length > 0) {
    clearQueue();
  }
  resetUI();
});

// Advanced Settings Modal Event Handlers
btnAdvancedSettings.addEventListener('click', () => {
  console.log('Advanced Settings button clicked');
  showAdvancedSettings();
});

btnCloseAdvanced.addEventListener('click', () => {
  hideAdvancedSettings();
});

btnCancelAdvanced.addEventListener('click', () => {
  hideAdvancedSettings();
});

btnSaveAdvanced.addEventListener('click', () => {
  saveAdvancedSettings();
});

// Close modal when clicking outside the modal content
advancedSettingsModal.addEventListener('click', (e) => {
  if (e.target === advancedSettingsModal) {
    hideAdvancedSettings();
  }
});

// Advanced Settings Functions
function showAdvancedSettings() {
  // Load current settings into the modal
  const modalCheckbox = advancedSettingsModal.querySelector('#enableDoubleVerification');
  modalCheckbox.checked = enableDoubleVerification.checked;
  
  // Load threshold settings into modal controls
  const modalEnableMultiCore = advancedSettingsModal.querySelector('#enableMultiCore');
  const modalHammingThreshold = advancedSettingsModal.querySelector('#hammingThreshold');
  const modalSsimThreshold = advancedSettingsModal.querySelector('#ssimThreshold');
  const modalPixelChangeRatioThreshold = advancedSettingsModal.querySelector('#pixelChangeRatioThreshold');
  const modalVerificationCount = advancedSettingsModal.querySelector('#verificationCount');
  const modalSizeIdenticalThreshold = advancedSettingsModal.querySelector('#sizeIdenticalThreshold');
  const modalSizeDiffThreshold = advancedSettingsModal.querySelector('#sizeDiffThreshold');
  
  if (modalEnableMultiCore) modalEnableMultiCore.checked = enableMultiCore.checked;
  if (modalHammingThreshold) modalHammingThreshold.value = hammingThreshold.value;
  if (modalSsimThreshold) modalSsimThreshold.value = ssimThreshold.value;
  if (modalPixelChangeRatioThreshold) modalPixelChangeRatioThreshold.value = pixelChangeRatioThreshold.value;
  if (modalVerificationCount) modalVerificationCount.value = verificationCount.value;
  if (modalSizeIdenticalThreshold) modalSizeIdenticalThreshold.value = sizeIdenticalThreshold.value;
  if (modalSizeDiffThreshold) modalSizeDiffThreshold.value = sizeDiffThreshold.value;
  
  advancedSettingsModal.style.display = 'flex';
  
  // Focus the modal for keyboard events
  advancedSettingsModal.focus();
}

function hideAdvancedSettings() {
  advancedSettingsModal.style.display = 'none';
}

async function saveAdvancedSettings() {
  try {
    // Get the checkbox from the modal
    const modalCheckbox = advancedSettingsModal.querySelector('#enableDoubleVerification');
    
    // Get threshold settings from modal
    const modalEnableMultiCore = advancedSettingsModal.querySelector('#enableMultiCore');
    const modalHammingThreshold = advancedSettingsModal.querySelector('#hammingThreshold');
    const modalSsimThreshold = advancedSettingsModal.querySelector('#ssimThreshold');
    const modalPixelChangeRatioThreshold = advancedSettingsModal.querySelector('#pixelChangeRatioThreshold');
    const modalVerificationCount = advancedSettingsModal.querySelector('#verificationCount');
    const modalSizeIdenticalThreshold = advancedSettingsModal.querySelector('#sizeIdenticalThreshold');
    const modalSizeDiffThreshold = advancedSettingsModal.querySelector('#sizeDiffThreshold');
    
    // Update the main controls (though they're not visible now)
    enableDoubleVerification.checked = modalCheckbox.checked;
    if (modalEnableMultiCore) enableMultiCore.checked = modalEnableMultiCore.checked;
    if (modalHammingThreshold) hammingThreshold.value = modalHammingThreshold.value;
    if (modalSsimThreshold) ssimThreshold.value = modalSsimThreshold.value;
    if (modalPixelChangeRatioThreshold) pixelChangeRatioThreshold.value = modalPixelChangeRatioThreshold.value;
    if (modalVerificationCount) verificationCount.value = modalVerificationCount.value;
    if (modalSizeIdenticalThreshold) sizeIdenticalThreshold.value = modalSizeIdenticalThreshold.value;
    if (modalSizeDiffThreshold) sizeDiffThreshold.value = modalSizeDiffThreshold.value;
    
    // Save the configuration
    await saveConfig();
    
    // Close the modal
    hideAdvancedSettings();
    
    // Show a brief status message
    const originalStatus = statusText.textContent;
    statusText.textContent = 'Advanced settings saved';
    setTimeout(() => {
      statusText.textContent = originalStatus;
    }, 2000);
  } catch (error) {
    console.error('Failed to save advanced settings:', error);
    statusText.textContent = 'Failed to save advanced settings';
  }
}

// Keyboard event handling for the modal
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && advancedSettingsModal.style.display === 'flex') {
    hideAdvancedSettings();
  }
});

// Save configuration
async function saveConfig() {
  try {
    const config = {
      outputDir: inputOutputDir.value,
      checkInterval: parseFloat(inputCheckInterval.value),
      comparisonMethod: comparisonMethod.value,
      enableDoubleVerification: enableDoubleVerification.checked,
      enableMultiCore: enableMultiCore.checked,
      hammingThreshold: parseFloat(hammingThreshold.value),
      ssimThreshold: parseFloat(ssimThreshold.value),
      pixelChangeRatioThreshold: parseFloat(pixelChangeRatioThreshold.value),
      verificationCount: parseInt(verificationCount.value),
      sizeIdenticalThreshold: parseFloat(sizeIdenticalThreshold.value),
      sizeDiffThreshold: parseFloat(sizeDiffThreshold.value)
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
    
    // Reset progress variable
    currentPhase = 'extracting';
    extractionProgress = 0;
    analyzingProgress = 0;
    totalActiveWorkers = 0;
    
    // Update UI
    btnStartProcess.disabled = true;
    btnStopProcess.disabled = false;
    btnReset.disabled = true; // Disable Reset button during processing
    updateTotalProgress(0);
    totalFrames.textContent = '0';
    extractedSlides.textContent = '0';
    processingTime.textContent = '0s';
    slidesContainer.innerHTML = '';
    statusText.textContent = 'Extracting video frames... (Phase 1/2)';
    
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
      onProgress: updateExtractionProgress // Update to the extraction-specific progress handler
    });
    
    framesDir = result.framesDir;
    tempDir = result.tempDir; // Save the temporary directory path for subsequent cleanup
    totalFrames.textContent = result.totalFrames;
    
    // Update Phase
    currentPhase = 'analyzing';
    
    // Update status text
    statusText.textContent = 'Initializing analysis... (Phase 2/2)';
    
    // Reset analyzing progress and update immediately
    analyzingProgress = 0;
    updateTotalProgress();
    
    // Process the extracted frames in main process
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
      
      // Complete processing - ensure progress reaches 100%
      analyzingProgress = 100;
      updateTotalProgress();
      
      // Also directly set to 100% to be absolutely sure
      setTimeout(() => {
        updateTotalProgress(100);
      }, 50);
      
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
  
  // Also stop queue processing
  if (isQueueProcessing) {
    isQueueProcessing = false;
    btnStartProcess.disabled = false;
    btnStopProcess.disabled = true;
    
    // Update remaining videos to pending status
    for (let i = currentQueueIndex; i < videoQueue.length; i++) {
      if (videoQueue[i].status === 'processing') {
        videoQueue[i].status = 'pending';
      }
    }
    updateQueueDisplay();
    
    statusText.textContent = 'Queue processing stopped';
  }
}

// Reset UI
function resetUI() {
  // Reset progress bar
  updateTotalProgress(0);
  
  // Reset progress tracking variables
  currentPhase = '';
  extractionProgress = 0;
  analyzingProgress = 0;
  
  // Reset statistics data
  totalFrames.textContent = '0';
  extractedSlides.textContent = '0';
  processingTime.textContent = '0s';
  
  // Clear slide preview
  slidesContainer.innerHTML = '';
  
  // Reset state text
  statusText.textContent = 'Ready';
  
  // Only clear video path if not in queue mode
  if (videoQueue.length === 0) {
    selectedVideoPath = '';
    inputVideo.value = '';
  }
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

// Update the overall progress, calculated based on the current stage and the progress of each respective stage
function updateTotalProgress(percent) {
  // If a specific percentage is provided, use it directly
  if (percent !== undefined) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = `${Math.round(percent)}%`;
    return;
  }
  
  // Otherwise, calculate the total progress based on the current stage and weight.
  let totalProgress = 0;
  
  if (currentPhase === 'extracting') {
    // Frame extraction phase in progress
    totalProgress = extractionProgress * extractionWeight;
  } else if (currentPhase === 'analyzing') {
    // Frame extraction completed, analysis phase in progress
    totalProgress = extractionWeight * 100 + analyzingProgress * analyzingWeight;
  }
  
  // Ensure progress doesn't exceed 100%
  totalProgress = Math.min(totalProgress, 100);
  
  // Update progress bar and text
  progressFill.style.width = `${totalProgress}%`;
  progressText.textContent = `${Math.round(totalProgress)}%`;
}

// Update the progress of the frame extraction stage
function updateExtractionProgress(progress) {
  if (!isProcessing) return;
  
  extractionProgress = progress.percent;
  updateTotalProgress();
  
  // Update the status text at the same time, showing the current processing time position
  statusText.textContent = `Extracting video frames... (Phase 1/2) ${Math.round(progress.currentTime)}/${Math.round(progress.totalTime)}s`;
}

// Update the progress of the analysis phase
function updateAnalysisProgress(progress) {
  if (!isProcessing) return;
  
  analyzingProgress = progress.percent;
  updateTotalProgress();
  
  processedFrames = progress.processedFrames;
  
  // Record the current number of active worker threads
  if (progress.workerId !== undefined) {
    // Update active worker thread count
    totalActiveWorkers = Math.max(totalActiveWorkers, progress.workerId + 1);
  }
  
  // Update status text, display current analyzed frame information and parallel processing information
  let phaseText = `Analyzing frame ${progress.processedFrames}/${progress.totalFrames} (Phase 2/2)`;
  
  statusText.textContent = phaseText;
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

// Smooth Transition Animation Function - Used for smooth progress bar transition during stage switching
function animateProgressTransition(startPercent, endPercent) {
  // Ensure the value is within a reasonable range
  startPercent = Math.max(0, Math.min(100, startPercent));
  endPercent = Math.max(0, Math.min(100, endPercent));
  
  // If the start and end values are the same, no animation is needed.
  if (Math.abs(startPercent - endPercent) < 0.1) return;
  
  const duration = 300; // Animation duration (milliseconds)
  const startTime = performance.now();
  
  function animate(currentTime) {
    const elapsedTime = currentTime - startTime;
    
    if (elapsedTime >= duration) {
      // Animation ended
      progressFill.style.width = `${endPercent}%`;
      progressText.textContent = `${Math.round(endPercent)}%`;
      return;
    }
    
    // Calculate the current progress value
    const progress = elapsedTime / duration;
    const currentPercent = startPercent + (endPercent - startPercent) * easeOutCubic(progress);
    
    // Update DOM
    progressFill.style.width = `${currentPercent}%`;
    progressText.textContent = `${Math.round(currentPercent)}%`;
    
    // Continue animation
    requestAnimationFrame(animate);
  }
  
  // Startup Animation
  requestAnimationFrame(animate);
}

// Smooth easing function
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Queue management functions
function showQueueSection() {
  queueSection.style.display = 'block';
  // Change button text to "Start Queue"
  btnStartProcess.textContent = 'Start Queue';
}

function hideQueueSection() {
  queueSection.style.display = 'none';
  // Reset button text to "Start Processing"
  btnStartProcess.textContent = 'Start Processing';
}

function updateQueueDisplay() {
  if (videoQueue.length === 0) {
    queueList.innerHTML = '<div class="queue-empty">No videos in queue</div>';
    return;
  }

  queueList.innerHTML = videoQueue.map(video => `
    <div class="queue-item ${video.status}" data-id="${video.id}">
      <div class="queue-item-info">
        <div class="queue-item-name" title="${video.path}">${video.name}</div>
        <div class="queue-item-status">${getStatusText(video.status)}</div>
      </div>
      ${video.status === 'pending' ? `<button class="queue-remove-btn" onclick="removeFromQueue(${video.id})">×</button>` : ''}
    </div>
  `).join('');
}

function getStatusText(status) {
  switch (status) {
    case 'pending': return 'Pending';
    case 'processing': return 'Processing...';
    case 'completed': return 'Completed';
    case 'error': return 'Error';
    default: return 'Unknown';
  }
}

function removeFromQueue(videoId) {
  if (isQueueProcessing) {
    statusText.textContent = 'Cannot remove videos while queue is processing';
    return;
  }
  
  videoQueue = videoQueue.filter(video => video.id !== videoId);
  updateQueueDisplay();
  
  if (videoQueue.length === 0) {
    clearQueue();
  } else {
    statusText.textContent = `${videoQueue.length} videos in queue`;
  }
}

function clearQueue() {
  if (isQueueProcessing) {
    statusText.textContent = 'Cannot clear queue while processing';
    return;
  }
  
  videoQueue = [];
  hideQueueSection();
  inputVideo.value = '';
  statusText.textContent = 'Ready';
}

// Queue processing functions
async function startQueueProcessing() {
  if (videoQueue.length === 0) {
    statusText.textContent = 'No videos in queue';
    return;
  }
  
  if (!inputOutputDir.value) {
    statusText.textContent = 'Please select an output directory first';
    return;
  }
  
  isQueueProcessing = true;
  currentQueueIndex = 0;
  
  // Update UI
  btnStartProcess.disabled = true;
  btnStopProcess.disabled = false;
  
  // Save configuration
  await saveConfig();
  
  // Start processing queue
  await processQueue();
}

async function processQueue() {
  while (currentQueueIndex < videoQueue.length && isQueueProcessing) {
    const currentVideo = videoQueue[currentQueueIndex];
    
    try {
      // Update video status to processing
      currentVideo.status = 'processing';
      updateQueueDisplay();
      
      // Set current video as selected
      selectedVideoPath = currentVideo.path;
      
      statusText.textContent = `Processing ${currentQueueIndex + 1}/${videoQueue.length}: ${currentVideo.name}`;
      
      // Start processing this video
      await startProcessing();
      
      // Mark as completed
      currentVideo.status = 'completed';
      updateQueueDisplay();
      
      // Wait a bit before next video (simulate manual operation)
      if (currentQueueIndex < videoQueue.length - 1 && isQueueProcessing) {
        statusText.textContent = 'Waiting before next video...';
        await sleep(2000); // Wait 2 seconds
        
        // Reset UI for next video
        resetUI();
        await sleep(1000); // Wait 1 second after reset
      }
      
    } catch (error) {
      console.error('Error processing video in queue:', error);
      currentVideo.status = 'error';
      updateQueueDisplay();
      
      // Continue with next video after error
      if (currentQueueIndex < videoQueue.length - 1 && isQueueProcessing) {
        statusText.textContent = `Error processing ${currentVideo.name}, continuing with next video...`;
        await sleep(2000);
        resetUI();
        await sleep(1000);
      }
    }
    
    currentQueueIndex++;
  }
  
  // Queue processing finished
  if (isQueueProcessing) {
    isQueueProcessing = false;
    btnStartProcess.disabled = false;
    btnStopProcess.disabled = true;
    
    const completedCount = videoQueue.filter(v => v.status === 'completed').length;
    const errorCount = videoQueue.filter(v => v.status === 'error').length;
    
    statusText.textContent = `Queue processing finished. Completed: ${completedCount}, Errors: ${errorCount}`;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Make removeFromQueue available globally
window.removeFromQueue = removeFromQueue;
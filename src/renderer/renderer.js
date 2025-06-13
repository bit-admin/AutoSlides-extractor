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
const videoQuality = document.getElementById('videoQuality');

// Post-processing elements
const enablePostProcessing = document.getElementById('enablePostProcessing');
const excludeFingerprintsTable = document.getElementById('excludeFingerprintsTable');
const excludeFingerprintsTableBody = document.getElementById('excludeFingerprintsTableBody');
const btnSelectImageFingerprint = document.getElementById('btnSelectImageFingerprint');
const btnTestSimilarity = document.getElementById('btnTestSimilarity');
const btnSelectSlidesDir = document.getElementById('btnSelectSlidesDir');
const btnRunPostProcess = document.getElementById('btnRunPostProcess');

// Region configuration elements
const regionConfigModal = document.getElementById('regionConfigModal');
const btnCloseRegionConfig = document.getElementById('btnCloseRegionConfig');
const btnCancelRegionConfig = document.getElementById('btnCancelRegionConfig');
const btnApplyRegionConfig = document.getElementById('btnApplyRegionConfig');
const enableRegionComparison = document.getElementById('enableRegionComparison');
const regionConfigOptions = document.getElementById('regionConfigOptions');
const regionWidth = document.getElementById('regionWidth');
const regionHeight = document.getElementById('regionHeight');
const regionWidthSlider = document.getElementById('regionWidthSlider');
const regionHeightSlider = document.getElementById('regionHeightSlider');
const regionAlignment = document.getElementById('regionAlignment');
const regionPreview = document.getElementById('regionPreview');
const regionPreviewImage = regionPreview.querySelector('.region-preview-image');
const regionPreviewOverlay = regionPreview.querySelector('.region-preview-overlay');
const regionPreviewBounds = regionPreview.querySelector('.region-preview-bounds');
const regionPreviewInfo = regionPreview.querySelector('.region-preview-info');

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

// Post-processing variables
let selectedSlidesDir = '';
let currentImagePath = '';
let currentRegionConfig = {
  enabled: false,
  width: 800,
  height: 600,
  alignment: 'center'
};

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
    
    // Load video processing settings
    videoQuality.value = config.videoQuality || 1;

    // Load post-processing settings
    enablePostProcessing.checked = config.enablePostProcessing !== false;
    
    // Initialize fingerprint display (data will be loaded from API)
    await updateExcludeFingerprintsList();
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

// Post-processing Event Handlers
btnSelectImageFingerprint.addEventListener('click', async () => {
  try {
    const imagePath = await window.electronAPI.selectImageFile();
    if (imagePath) {
      currentImagePath = imagePath;
      showRegionConfigModal();
    }
  } catch (error) {
    console.error('Failed to select image file:', error);
    statusText.textContent = 'Error selecting image file';
  }
});

btnSelectSlidesDir.addEventListener('click', async () => {
  try {
    const dirPath = await window.electronAPI.selectSlidesDir();
    if (dirPath) {
      selectedSlidesDir = dirPath;
      statusText.textContent = `Selected slides directory: ${dirPath}`;
      btnRunPostProcess.disabled = false;
    }
  } catch (error) {
    console.error('Failed to select slides directory:', error);
    statusText.textContent = 'Error selecting slides directory';
  }
});

btnRunPostProcess.addEventListener('click', async () => {
  if (!selectedSlidesDir) {
    statusText.textContent = 'Please select a slides directory first';
    return;
  }
  
  // Get current exclude fingerprints from API
  try {
    const fingerprintsResult = await window.electronAPI.getExcludeFingerprints();
    if (!fingerprintsResult.success || fingerprintsResult.excludeFingerprints.length === 0) {
      statusText.textContent = 'No exclude fingerprints configured';
      return;
    }
  } catch (error) {
    statusText.textContent = 'Error checking fingerprints configuration';
    return;
  }
  
  try {
    btnRunPostProcess.disabled = true;
    statusText.textContent = 'Running post-processing...';
    
    // Pass empty array since the backend will use config.excludeFingerprints
    const result = await window.electronAPI.postProcessSlides(selectedSlidesDir, []);
    
    if (result.success) {
      statusText.textContent = `Post-processing completed. Removed ${result.removedCount} similar images.`;
    } else {
      statusText.textContent = `Post-processing failed: ${result.error}`;
    }
  } catch (error) {
    console.error('Post-processing failed:', error);
    statusText.textContent = 'Post-processing failed';
  } finally {
    btnRunPostProcess.disabled = false;
    setTimeout(() => {
      statusText.textContent = 'Ready';
    }, 5000);
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
  const modalVideoQuality = advancedSettingsModal.querySelector('#videoQuality');
  
  // Load post-processing settings into modal controls
  const modalEnablePostProcessing = advancedSettingsModal.querySelector('#enablePostProcessing');
  
  if (modalEnableMultiCore) modalEnableMultiCore.checked = enableMultiCore.checked;
  if (modalHammingThreshold) modalHammingThreshold.value = hammingThreshold.value;
  if (modalSsimThreshold) modalSsimThreshold.value = ssimThreshold.value;
  if (modalPixelChangeRatioThreshold) modalPixelChangeRatioThreshold.value = pixelChangeRatioThreshold.value;
  if (modalVerificationCount) modalVerificationCount.value = verificationCount.value;
  if (modalSizeIdenticalThreshold) modalSizeIdenticalThreshold.value = sizeIdenticalThreshold.value;
  if (modalSizeDiffThreshold) modalSizeDiffThreshold.value = sizeDiffThreshold.value;
  if (modalVideoQuality) modalVideoQuality.value = videoQuality.value;
  if (modalEnablePostProcessing) modalEnablePostProcessing.checked = enablePostProcessing.checked;
  
  // Update exclude fingerprints list in modal
  updateExcludeFingerprintsList();
  
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
    const modalVideoQuality = advancedSettingsModal.querySelector('#videoQuality');
    
    // Get post-processing settings from modal
    const modalEnablePostProcessing = advancedSettingsModal.querySelector('#enablePostProcessing');
    
    // Update the main controls (though they're not visible now)
    enableDoubleVerification.checked = modalCheckbox.checked;
    if (modalEnableMultiCore) enableMultiCore.checked = modalEnableMultiCore.checked;
    if (modalHammingThreshold) hammingThreshold.value = modalHammingThreshold.value;
    if (modalSsimThreshold) ssimThreshold.value = modalSsimThreshold.value;
    if (modalPixelChangeRatioThreshold) pixelChangeRatioThreshold.value = modalPixelChangeRatioThreshold.value;
    if (modalVerificationCount) verificationCount.value = modalVerificationCount.value;
    if (modalSizeIdenticalThreshold) sizeIdenticalThreshold.value = modalSizeIdenticalThreshold.value;
    if (modalSizeDiffThreshold) videoQuality.value = modalSizeDiffThreshold.value;
    if (modalVideoQuality) videoQuality.value = modalVideoQuality.value;
    if (modalEnablePostProcessing) enablePostProcessing.checked = modalEnablePostProcessing.checked;
    
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
  if (e.key === 'Escape' && regionConfigModal.style.display === 'flex') {
    hideRegionConfigModal();
  }
});

// ===== Region Configuration Modal Functions =====

function showRegionConfigModal() {
  // Reset form to current configuration
  enableRegionComparison.checked = currentRegionConfig.enabled;
  regionWidth.value = currentRegionConfig.width;
  regionHeight.value = currentRegionConfig.height;
  regionWidthSlider.value = currentRegionConfig.width;
  regionHeightSlider.value = currentRegionConfig.height;
  regionAlignment.value = currentRegionConfig.alignment;
  
  // Update slider visual progress
  updateSliderProgress(regionWidthSlider, regionWidth);
  updateSliderProgress(regionHeightSlider, regionHeight);
  
  // Show/hide options based on checkbox
  regionConfigOptions.style.display = currentRegionConfig.enabled ? 'block' : 'none';
  
  // Load image preview
  loadImagePreview();
  
  // Show modal
  regionConfigModal.style.display = 'flex';
}

function hideRegionConfigModal(clearImagePath = true) {
  regionConfigModal.style.display = 'none';
  if (clearImagePath) {
    currentImagePath = '';
  }
}

async function loadImagePreview() {
  if (!currentImagePath) return;
  
  try {
    // Create image element
    const img = document.createElement('img');
    img.onload = function() {
      // Clear previous content
      regionPreviewImage.innerHTML = '';
      regionPreviewImage.appendChild(img);
      regionPreviewImage.appendChild(regionPreviewOverlay);
      regionPreviewImage.appendChild(regionPreviewBounds);
      
      // Update preview
      updateRegionPreview(img.naturalWidth, img.naturalHeight);
    };
    
    // Load image data
    const imageData = await window.electronAPI.readFrameImage(currentImagePath);
    img.src = imageData;
    img.style.maxWidth = '100%';
    img.style.maxHeight = '100%';
    img.style.objectFit = 'contain';
    
  } catch (error) {
    console.error('Failed to load image preview:', error);
    regionPreviewInfo.innerHTML = '<p>Failed to load image preview</p>';
  }
}

function updateRegionPreview(imageWidth, imageHeight) {
  if (!enableRegionComparison.checked) {
    regionPreviewOverlay.style.display = 'none';
    regionPreviewBounds.style.display = 'none';
    regionPreviewInfo.innerHTML = `
      <div class="preview-header">
        <span class="region-title">Full Image Comparison</span>
        <span class="coverage-badge">100%</span>
      </div>
      <div class="preview-grid">
        <div class="info-item">
          <span class="info-label">Image Size</span>
          <span class="info-value">${imageWidth}×${imageHeight}</span>
        </div>
        <div class="info-item">
          <span class="info-label">Mode</span>
          <span class="info-value">Full Image</span>
        </div>
      </div>
    `;
    return;
  }
  
  const regionW = parseInt(regionWidth.value) || 800;
  const regionH = parseInt(regionHeight.value) || 600;
  const alignment = regionAlignment.value;
  
  // Calculate region bounds
  const bounds = calculateRegionBounds(imageWidth, imageHeight, {
    enabled: true,
    width: regionW,
    height: regionH,
    alignment: alignment
  });
  
  // Get preview container dimensions
  const containerRect = regionPreviewImage.getBoundingClientRect();
  const containerWidth = containerRect.width;
  const containerHeight = containerRect.height;
  
  // Calculate scale to fit image in container
  const scaleX = containerWidth / imageWidth;
  const scaleY = containerHeight / imageHeight;
  const scale = Math.min(scaleX, scaleY);
  
  // Calculate scaled dimensions
  const scaledImageWidth = imageWidth * scale;
  const scaledImageHeight = imageHeight * scale;
  
  // Calculate offset to center image in container
  const offsetX = (containerWidth - scaledImageWidth) / 2;
  const offsetY = (containerHeight - scaledImageHeight) / 2;
  
  // Calculate scaled region bounds
  const scaledBounds = {
    x: bounds.x * scale + offsetX,
    y: bounds.y * scale + offsetY,
    width: bounds.width * scale,
    height: bounds.height * scale
  };
  
  // Update overlay and bounds
  regionPreviewOverlay.style.display = 'block';
  regionPreviewBounds.style.display = 'block';
  regionPreviewBounds.style.left = scaledBounds.x + 'px';
  regionPreviewBounds.style.top = scaledBounds.y + 'px';
  regionPreviewBounds.style.width = scaledBounds.width + 'px';
  regionPreviewBounds.style.height = scaledBounds.height + 'px';
  
  // Update info with improved layout
  regionPreviewInfo.innerHTML = `
    <div class="preview-header">
      <span class="region-title">Region: ${bounds.width}×${bounds.height}</span>
      <span class="coverage-badge">${((bounds.width * bounds.height) / (imageWidth * imageHeight) * 100).toFixed(1)}%</span>
    </div>
    <div class="preview-grid">
      <div class="info-item">
        <span class="info-label">Position</span>
        <span class="info-value">(${bounds.x}, ${bounds.y})</span>
      </div>
      <div class="info-item">
        <span class="info-label">Alignment</span>
        <span class="info-value">${alignment}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Image Size</span>
        <span class="info-value">${imageWidth}×${imageHeight}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Region Size</span>
        <span class="info-value">${bounds.width}×${bounds.height}</span>
      </div>
    </div>
  `;
}

function calculateRegionBounds(imageWidth, imageHeight, regionConfig) {
  const targetWidth = regionConfig.width || imageWidth;
  const targetHeight = regionConfig.height || imageHeight;
  
  // Ensure target dimensions don't exceed image dimensions
  const finalWidth = Math.min(targetWidth, imageWidth);
  const finalHeight = Math.min(targetHeight, imageHeight);
  
  let x = 0, y = 0;
  
  // Calculate position based on alignment
  switch (regionConfig.alignment) {
    case 'top-left':
      x = 0;
      y = 0;
      break;
    case 'top-center':
      x = Math.floor((imageWidth - finalWidth) / 2);
      y = 0;
      break;
    case 'top-right':
      x = imageWidth - finalWidth;
      y = 0;
      break;
    case 'center-left':
      x = 0;
      y = Math.floor((imageHeight - finalHeight) / 2);
      break;
    case 'center':
      x = Math.floor((imageWidth - finalWidth) / 2);
      y = Math.floor((imageHeight - finalHeight) / 2);
      break;
    case 'center-right':
      x = imageWidth - finalWidth;
      y = Math.floor((imageHeight - finalHeight) / 2);
      break;
    case 'bottom-left':
      x = 0;
      y = imageHeight - finalHeight;
      break;
    case 'bottom-center':
      x = Math.floor((imageWidth - finalWidth) / 2);
      y = imageHeight - finalHeight;
      break;
    case 'bottom-right':
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

// Region configuration event handlers
enableRegionComparison.addEventListener('change', () => {
  regionConfigOptions.style.display = enableRegionComparison.checked ? 'block' : 'none';
  
  // Update preview if image is loaded
  const img = regionPreviewImage.querySelector('img');
  if (img && img.naturalWidth > 0) {
    updateRegionPreview(img.naturalWidth, img.naturalHeight);
  }
});

// Function to update slider visual progress
function updateSliderProgress(slider, input) {
  const value = parseInt(input.value);
  const min = parseInt(slider.min);
  const max = parseInt(slider.max);
  const progress = ((value - min) / (max - min)) * 100;
  
  slider.style.setProperty('--slider-progress', `${progress}%`);
  
  // Update thumb position for tooltip
  const sliderGroup = slider.closest('.slider-input-group');
  if (sliderGroup) {
    sliderGroup.style.setProperty('--thumb-position', `${progress}%`);
  }
}

// Enhanced region configuration event handlers with visual feedback
enableRegionComparison.addEventListener('change', () => {
  regionConfigOptions.style.display = enableRegionComparison.checked ? 'block' : 'none';
  
  // Update preview if image is loaded
  const img = regionPreviewImage.querySelector('img');
  if (img && img.naturalWidth > 0) {
    updateRegionPreview(img.naturalWidth, img.naturalHeight);
  }
});

// Sync width slider and input with visual updates
regionWidthSlider.addEventListener('input', () => {
  regionWidth.value = regionWidthSlider.value;
  updateSliderProgress(regionWidthSlider, regionWidth);
  
  const img = regionPreviewImage.querySelector('img');
  if (img && img.naturalWidth > 0) {
    updateRegionPreview(img.naturalWidth, img.naturalHeight);
  }
});

regionWidth.addEventListener('input', () => {
  const value = parseInt(regionWidth.value) || 100;
  const clampedValue = Math.max(100, Math.min(3840, value));
  
  if (value !== clampedValue) {
    regionWidth.value = clampedValue;
  }
  
  regionWidthSlider.value = clampedValue;
  updateSliderProgress(regionWidthSlider, regionWidth);
  
  const img = regionPreviewImage.querySelector('img');
  if (img && img.naturalWidth > 0) {
    updateRegionPreview(img.naturalWidth, img.naturalHeight);
  }
});

// Sync height slider and input with visual updates
regionHeightSlider.addEventListener('input', () => {
  regionHeight.value = regionHeightSlider.value;
  updateSliderProgress(regionHeightSlider, regionHeight);
  
  const img = regionPreviewImage.querySelector('img');
  if (img && img.naturalWidth > 0) {
    updateRegionPreview(img.naturalWidth, img.naturalHeight);
  }
});

regionHeight.addEventListener('input', () => {
  const value = parseInt(regionHeight.value) || 100;
  const clampedValue = Math.max(100, Math.min(2160, value));
  
  if (value !== clampedValue) {
    regionHeight.value = clampedValue;
  }
  
  regionHeightSlider.value = clampedValue;
  updateSliderProgress(regionHeightSlider, regionHeight);
  
  const img = regionPreviewImage.querySelector('img');
  if (img && img.naturalWidth > 0) {
    updateRegionPreview(img.naturalWidth, img.naturalHeight);
  }
});

regionAlignment.addEventListener('change', () => {
  const img = regionPreviewImage.querySelector('img');
  if (img && img.naturalWidth > 0) {
    updateRegionPreview(img.naturalWidth, img.naturalHeight);
  }
});

btnCloseRegionConfig.addEventListener('click', () => hideRegionConfigModal(true));
btnCancelRegionConfig.addEventListener('click', () => hideRegionConfigModal(true));

btnApplyRegionConfig.addEventListener('click', async () => {
  try {
    // Update current region configuration
    currentRegionConfig = {
      enabled: enableRegionComparison.checked,
      width: enableRegionComparison.checked ? parseInt(regionWidth.value) || 800 : null,
      height: enableRegionComparison.checked ? parseInt(regionHeight.value) || 600 : null,
      alignment: regionAlignment.value
    };
    
    // Validate image path
    if (!currentImagePath) {
      statusText.textContent = 'Error: No image selected. Please select an image first.';
      hideRegionConfigModal();
      return;
    }
    
    // Hide modal without clearing the image path
    hideRegionConfigModal(false);      // Calculate fingerprint with region configuration
    statusText.textContent = 'Calculating SSIM fingerprint with region configuration...';
    
    // Log the image path for debugging
    console.log('[Add from Image] Using image path for fingerprint calculation:', currentImagePath);
    
    const result = await window.electronAPI.calculateImageSSIMFingerprint({
      imagePath: currentImagePath,
      store: true,
      name: `Fingerprint_${Date.now()}`,
      threshold: 0.95,
      regionConfig: currentRegionConfig
    });
    
    if (result && result.success && result.id) {
      await addExcludeFingerprint(result.id, result.metadata.threshold);
      
      const regionInfo = result.regionConfig ? 
        ` (Region: ${result.regionConfig.width}×${result.regionConfig.height}, ${result.regionConfig.alignment})` : 
        ' (Full image)';
      
      statusText.textContent = `Fingerprint calculated and added: ${result.metadata.name}${regionInfo}`;
      setTimeout(() => {
        statusText.textContent = 'Ready';
      }, 3000);
    } else {
      statusText.textContent = 'Failed to calculate fingerprint';
    }
    
  } catch (error) {
    console.error('Failed to apply region configuration:', error);
    statusText.textContent = 'Error applying region configuration';
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
      sizeDiffThreshold: parseFloat(sizeDiffThreshold.value),
      videoQuality: parseInt(videoQuality.value),
      enablePostProcessing: enablePostProcessing.checked
      // Note: excludeFingerprints is now managed through the index system
    };
    
    await window.electronAPI.saveConfig(config);
  } catch (error) {
    console.error('Failed to save configuration:', error);
  }
}

// Post-processing utility functions
async function updateExcludeFingerprintsList() {
  const tableBody = document.getElementById('excludeFingerprintsTableBody');
  tableBody.innerHTML = '';
  
  try {
    // Get exclude fingerprints with complete metadata from index
    const result = await window.electronAPI.getExcludeFingerprints();
    
    if (result.success) {
      const excludeFingerprints = result.excludeFingerprints;
      
      excludeFingerprints.forEach((fingerprintData, index) => {
        const row = document.createElement('tr');
        row.setAttribute('data-fingerprint-id', fingerprintData.id);
        row.setAttribute('data-index', index);
        
        // Fingerprint name cell
        const nameCell = document.createElement('td');
        nameCell.className = 'fingerprint-name-cell';
        
        const nameDisplay = document.createElement('div');
        nameDisplay.className = 'fingerprint-name-display';
        const fullName = fingerprintData.name || fingerprintData.id || 'Unknown Fingerprint';
        
        // Check if this is a preset fingerprint
        const isPreset = fingerprintData.id.startsWith('preset_') || 
                         (fingerprintData.fingerprint && fingerprintData.fingerprint.preset);
        
        // Add preset indicator if applicable
        if (isPreset) {
          nameDisplay.classList.add('preset-fingerprint');
        }
        
        // Truncate long names with ellipsis
        if (fullName.length > 25) {
          nameDisplay.textContent = fullName.substring(0, 22) + '...';
          nameDisplay.title = fullName; // Show full name on hover
        } else {
          nameDisplay.textContent = fullName;
          nameDisplay.title = `Fingerprint ID: ${fingerprintData.id}${isPreset ? ' (Preset Fingerprint)' : ''}`;
        }
        
        nameCell.appendChild(nameDisplay);
        
        // Threshold cell  
        const thresholdCell = document.createElement('td');
        thresholdCell.className = 'threshold-cell';
        
        const thresholdDisplay = document.createElement('div');
        thresholdDisplay.className = 'threshold-display';
        const thresholdValue = fingerprintData.threshold || 0.95;
        thresholdDisplay.textContent = thresholdValue.toFixed(2);
        thresholdDisplay.title = 'Click to edit SSIM similarity threshold (0.0 - 1.0)';
        
        thresholdCell.appendChild(thresholdDisplay);
        
        // Actions cell
        const actionsCell = document.createElement('td');
        actionsCell.className = 'actions-cell';
        
        // Edit button with SVG icon
        const editBtn = document.createElement('button');
        editBtn.className = 'row-action-button edit';
        editBtn.title = 'Edit fingerprint';
        editBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      `;
      editBtn.onclick = () => editExcludeFingerprint(fingerprintData.id);
      
      // Delete button with SVG icon
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'row-action-button delete';
      deleteBtn.title = 'Remove fingerprint';
      deleteBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3,6 5,6 21,6"/>
          <path d="M19,6v14a2,2,0,0,1-2-2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/>
          <line x1="10" y1="11" x2="10" y2="17"/>
          <line x1="14" y1="11" x2="14" y2="17"/>
        </svg>
      `;
      
      // Check if this is a preset fingerprint (starts with 'preset_' or has preset flag)
      const isPresetFingerprint = fingerprintData.id.startsWith('preset_') || 
                       (fingerprintData.fingerprint && fingerprintData.fingerprint.preset);
      
      if (isPresetFingerprint) {
        // For preset fingerprints, disable delete button and show different tooltip
        deleteBtn.className = 'row-action-button delete disabled';
        deleteBtn.title = 'Cannot delete preset fingerprint';
        deleteBtn.disabled = true;
        deleteBtn.onclick = () => {
          alert('Preset fingerprints cannot be deleted. If you need to remove them, please remove them from config.json.');
        };
      } else {
        deleteBtn.onclick = () => removeExcludeFingerprint(fingerprintData.id);
      }
      
      actionsCell.appendChild(editBtn);
      actionsCell.appendChild(deleteBtn);
      
      row.appendChild(nameCell);
      row.appendChild(thresholdCell);
      row.appendChild(actionsCell);
      tableBody.appendChild(row);
    });
    
    // Add empty state row if no fingerprints
    if (excludeFingerprints.length === 0) {
      const emptyRow = document.createElement('tr');
      const emptyCell = document.createElement('td');
      emptyCell.colSpan = 3;
      emptyCell.className = 'fingerprint-empty';
      emptyCell.textContent = 'No exclude fingerprints configured';
      emptyRow.appendChild(emptyCell);
      tableBody.appendChild(emptyRow);
    }
  } else {
    console.error('Failed to load exclude fingerprints:', result.error || 'Unknown error');
    
    // Show error in table
    const errorRow = document.createElement('tr');
    const errorCell = document.createElement('td');
    errorCell.colSpan = 3;
    errorCell.className = 'fingerprint-error';
    errorCell.textContent = 'Error loading fingerprints. Please try again.';
    errorRow.appendChild(errorCell);
    tableBody.appendChild(errorRow);
  }
} catch (error) {
  console.error('Error updating exclude fingerprints list:', error);
  
  // Show error in table
  const errorRow = document.createElement('tr');
  const errorCell = document.createElement('td');
  errorCell.colSpan = 3;
  errorCell.className = 'fingerprint-error';
  errorCell.textContent = 'Error loading fingerprints. Please try again.';
  errorRow.appendChild(errorCell);
  tableBody.appendChild(errorRow);
}
}

async function addExcludeFingerprint(fingerprintId, threshold = 0.95) {
  try {
    // Check if fingerprint already exists in exclude list
    const excludeResult = await window.electronAPI.getExcludeFingerprints();
    if (excludeResult.success) {
      const existingFingerprint = excludeResult.excludeFingerprints.find(item => item.id === fingerprintId);
      
      if (!existingFingerprint) {
        // Add to exclude list with backend API
        await window.electronAPI.addFingerprintToExcludes({ id: fingerprintId, threshold });
        
        // Update display
        await updateExcludeFingerprintsList();
        
        // Auto-save local configuration
        await saveConfig();
        return true;
      } else {
        console.log('Fingerprint already exists in exclude list');
        return false;
      }
    } else {
      console.error('Failed to get exclude fingerprints:', excludeResult);
      return false;
    }
  } catch (error) {
    console.error('Failed to add exclude fingerprint:', error);
    return false;
  }
}

async function removeExcludeFingerprint(fingerprintId) {
  try {
    // Remove from backend configuration
    await window.electronAPI.removeFingerprintFromExcludes(fingerprintId);
    
    // Update the display
    await updateExcludeFingerprintsList();
    
    // Auto-save local configuration
    await saveConfig();
    
    statusText.textContent = `Removed fingerprint: ${fingerprintId}`;
    setTimeout(() => {
      statusText.textContent = 'Ready';
    }, 2000);
  } catch (error) {
    console.error('Failed to remove exclude fingerprint:', error);
    statusText.textContent = 'Failed to remove fingerprint';
  }
}

// Automatic post-processing after video completion
async function runAutomaticPostProcessing(slidesDir) {
  if (!enablePostProcessing.checked) {
    return { success: true, skipped: true };
  }
  
  // Check if there are any exclude fingerprints configured
  try {
    const fingerprintsResult = await window.electronAPI.getExcludeFingerprints();
    if (!fingerprintsResult.success || fingerprintsResult.excludeFingerprints.length === 0) {
      return { success: true, skipped: true };
    }
  } catch (error) {
    console.error('Error checking fingerprints for auto post-processing:', error);
    return { success: true, skipped: true };
  }
  
  try {
    statusText.textContent = 'Running automatic post-processing...';
    // Pass empty array since the backend will use config.excludeFingerprints
    const result = await window.electronAPI.postProcessSlides(slidesDir, []);
    
    if (result.success) {
      statusText.textContent = `Post-processing completed. Removed ${result.removedCount} similar images.`;
      return result;
    } else {
      statusText.textContent = `Post-processing failed: ${result.error}`;
      return result;
    }
  } catch (error) {
    console.error('Automatic post-processing failed:', error);
    statusText.textContent = 'Automatic post-processing failed';
    return { success: false, error: error.message };
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
      
      // Run automatic post-processing if enabled
      const slidesDir = await window.electronAPI.createSlidesDir(inputOutputDir.value);
      const postProcessResult = await runAutomaticPostProcessing(slidesDir);
      
      if (postProcessResult.skipped) {
        statusText.textContent = `Processing complete, extracted ${extractedCount} slides`;
      } else if (postProcessResult.success) {
        const finalCount = extractedCount - postProcessResult.removedCount;
        statusText.textContent = `Processing complete, extracted ${extractedCount} slides (${postProcessResult.removedCount} removed by post-processing, ${finalCount} final)`;
      } else {
        statusText.textContent = `Processing complete, extracted ${extractedCount} slides (post-processing failed)`;
      }
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

// Fingerprint editing functions
function editExcludeFingerprint(fingerprintId) {
  const tableBody = document.getElementById('excludeFingerprintsTableBody');
  const row = tableBody.querySelector(`tr[data-fingerprint-id="${fingerprintId}"]`);
  
  if (row) {
    // Toggle editing state
    if (row.classList.contains('editing')) {
      // Save changes
      saveFingerprintEdit(fingerprintId, row);
    } else {
      // Enter edit mode
      enterFingerprintEditMode(fingerprintId, row);
    }
  }
}

async function enterFingerprintEditMode(fingerprintId, row) {
  try {
    // Load current fingerprint metadata
    const fingerprintData = await window.electronAPI.loadFingerprintById(fingerprintId);
    
    if (!fingerprintData.success) {
      throw new Error('Failed to load fingerprint data');
    }
    
    const currentName = fingerprintData.metadata.name || fingerprintId || 'Unknown Fingerprint';
    const currentThreshold = fingerprintData.metadata.threshold || 0.95;
    
    // Mark row as editing
    row.classList.add('editing');
    
    // Replace name display with input
    const nameCell = row.querySelector('.fingerprint-name-cell');
    const nameDisplay = nameCell.querySelector('.fingerprint-name-display');
    
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'fingerprint-name-input';
    nameInput.value = currentName;
    nameInput.maxLength = 50;
    nameInput.placeholder = 'Enter fingerprint name';
    
    nameCell.innerHTML = '';
    nameCell.appendChild(nameInput);
    
    // Replace threshold display with input
    const thresholdCell = row.querySelector('.threshold-cell');
    const thresholdDisplay = thresholdCell.querySelector('.threshold-display');
    
    const thresholdInput = document.createElement('input');
    thresholdInput.type = 'number';
    thresholdInput.className = 'threshold-input-edit';
    thresholdInput.value = currentThreshold;
    thresholdInput.min = '0';
    thresholdInput.max = '1';
    thresholdInput.step = '0.01';
    thresholdInput.placeholder = 'Threshold';
    
    thresholdCell.innerHTML = '';
    thresholdCell.appendChild(thresholdInput);
    
    // Update buttons in actions cell
    const actionsCell = row.querySelector('.actions-cell');
    const editBtn = actionsCell.querySelector('.row-action-button.edit');
    const deleteBtn = actionsCell.querySelector('.row-action-button.delete');
    
    // Change edit button to save
    editBtn.className = 'row-action-button save';
    editBtn.title = 'Save changes';
    editBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20,6 9,17 4,12"/>
    </svg>
    `;
    
    // Change delete button to cancel
    deleteBtn.className = 'row-action-button cancel';
    deleteBtn.title = 'Cancel editing';
    deleteBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    `;
    
    // Update click handlers
    editBtn.onclick = () => saveFingerprintEdit(fingerprintId, row);
    deleteBtn.onclick = () => cancelFingerprintEdit(fingerprintId, row);
    
    // Focus on name input
    nameInput.focus();
    nameInput.select();
  } catch (error) {
    console.error('Error entering edit mode:', error);
    statusText.textContent = 'Failed to enter edit mode';
  }
}

async function saveFingerprintEdit(fingerprintId, row) {
  const nameInput = row.querySelector('.fingerprint-name-input');
  const thresholdInput = row.querySelector('.threshold-input-edit');
  
  const newName = nameInput.value.trim();
  const newThreshold = parseFloat(thresholdInput.value) || 0.95;
  
  // Validate name
  if (!newName || newName.length < 1) {
    alert('Please enter a valid fingerprint name');
    nameInput.focus();
    return;
  }
  
  // Validate threshold
  if (newThreshold < 0 || newThreshold > 1) {
    alert('Threshold must be between 0.0 and 1.0');
    thresholdInput.focus();
    return;
  }
  
  try {
    // Update the fingerprint metadata in the index
    await window.electronAPI.updateFingerprint({ 
      id: fingerprintId, 
      name: newName,
      threshold: newThreshold 
    });
    
    // Exit edit mode and refresh
    exitFingerprintEditMode(row);
    await updateExcludeFingerprintsList();
    await saveConfig();
    
    statusText.textContent = `Updated fingerprint: ${newName}`;
    setTimeout(() => {
      statusText.textContent = 'Ready';
    }, 2000);
  } catch (error) {
    console.error('Failed to save fingerprint edit:', error);
    statusText.textContent = 'Failed to save changes';
    setTimeout(() => {
      statusText.textContent = 'Ready';
    }, 2000);
  }
}

function cancelFingerprintEdit(fingerprintId, row) {
  exitFingerprintEditMode(row);
  updateExcludeFingerprintsList();
}

function exitFingerprintEditMode(row) {
  row.classList.remove('editing');
}

// Similarity testing functionality
btnTestSimilarity.addEventListener('click', async () => {
  try {
    // Check if there are any fingerprints to test against
    const fingerprintsResult = await window.electronAPI.getExcludeFingerprints();
    if (!fingerprintsResult.success || fingerprintsResult.excludeFingerprints.length === 0) {
      statusText.textContent = 'No fingerprints configured for testing';
      return;
    }
    
    const excludeFingerprints = fingerprintsResult.excludeFingerprints;

    const imagePath = await window.electronAPI.selectImageFile();
    if (imagePath) {
      // Set current image path for testing
      currentImagePath = imagePath;
      
      // Run similarity test directly without asking for region configuration
      await runSimilarityTest(excludeFingerprints);
    }
  } catch (error) {
    console.error('Failed to test image similarity:', error);
    statusText.textContent = 'Error testing image similarity';
  }
});

// Show region configuration modal for test similarity
function showTestSimilarityRegionModal(excludeFingerprints) {
  // Reset form to current configuration
  enableRegionComparison.checked = currentRegionConfig.enabled;
  regionWidth.value = currentRegionConfig.width;
  regionHeight.value = currentRegionConfig.height;
  regionWidthSlider.value = currentRegionConfig.width;
  regionHeightSlider.value = currentRegionConfig.height;
  regionAlignment.value = currentRegionConfig.alignment;
  
  // Update slider visual progress
  updateSliderProgress(regionWidthSlider, regionWidth);
  updateSliderProgress(regionHeightSlider, regionHeight);
  
  // Show/hide options based on checkbox
  regionConfigOptions.style.display = currentRegionConfig.enabled ? 'block' : 'none';
  
  // Load image preview
  loadImagePreview();
  
  // Update modal title and button text for testing
  const modalHeader = regionConfigModal.querySelector('.modal-header h3');
  const applyButton = btnApplyRegionConfig;
  
  modalHeader.textContent = 'Test Similarity - Region Configuration';
  applyButton.textContent = 'Run Test';
  
  // Replace the apply button handler temporarily
  const originalHandler = applyButton.onclick;
  applyButton.onclick = async () => {
    try {
      // Update current region configuration
      const testRegionConfig = {
        enabled: enableRegionComparison.checked,
        width: enableRegionComparison.checked ? parseInt(regionWidth.value) || 800 : null,
        height: enableRegionComparison.checked ? parseInt(regionHeight.value) || 600 : null,
        alignment: regionAlignment.value
      };
      
      // Hide modal without clearing the image path
      hideRegionConfigModal(false);
      
      // Restore original modal state
      modalHeader.textContent = 'Region Configuration';
      applyButton.textContent = 'Apply Configuration';
      applyButton.onclick = originalHandler;
      
      // Run similarity test with region configuration
      await runSimilarityTestWithRegion(excludeFingerprints, testRegionConfig);
      
    } catch (error) {
      console.error('Failed to run similarity test:', error);
      statusText.textContent = 'Error running similarity test';
      
      // Restore original modal state
      modalHeader.textContent = 'Region Configuration';
      applyButton.textContent = 'Apply Configuration';
      applyButton.onclick = originalHandler;
    }
  };
  
  // Show modal
  regionConfigModal.style.display = 'flex';
}

async function runSimilarityTest(excludeFingerprints) {
  try {
    // Validate image path
    if (!currentImagePath) {
      statusText.textContent = 'Error: No image selected. Please select an image first.';
      return;
    }
    
    statusText.textContent = 'Testing similarity against stored fingerprints...';
    
    let bestMatch = null;
    let bestSimilarity = 0;
    let matchCount = 0;
    const testResults = [];
    
    // Test against all existing fingerprints using their stored region configurations
    for (const excludeItem of excludeFingerprints) {
      try {
        // Use the new test-fingerprint-similarity API
        const result = await window.electronAPI.testFingerprintSimilarity({
          fingerprintId: excludeItem.id,
          testImagePath: currentImagePath
        });
        
        if (result.success) {
          const similarityValue = result.similarity;
          const threshold = result.threshold;
          const isMatch = result.isMatch;
          
          // Count matches
          if (isMatch) {
            matchCount++;
          }
          
          // Track best match
          if (similarityValue > bestSimilarity) {
            bestSimilarity = similarityValue;
            bestMatch = {
              name: excludeItem.name,
              similarity: similarityValue,
              threshold: threshold,
              isMatch: isMatch,
              storedRegionConfig: result.storedFingerprint.regionConfig
            };
          }
          
          // Store test result
          testResults.push({
            name: excludeItem.name,
            similarity: similarityValue,
            threshold: threshold,
            isMatch: isMatch,
            regionConfig: result.storedFingerprint.regionConfig
          });
        }
      } catch (error) {
        console.error(`Error testing against fingerprint ${excludeItem.id}:`, error);
      }
    }
    
    // Display results
    const imageName = currentImagePath.split('/').pop();
    if (bestMatch) {
      const matchStatus = bestMatch.isMatch ? 'MATCH' : 'NO MATCH';
      
      // Create enhanced results dialog
      const dialog = document.createElement('div');
      dialog.className = 'similarity-test-dialog';
      
      // Format data as JSON-like structure with region info
      const jsonData = {
        testImage: imageName,
        analysis: {
          bestMatch: {
            name: bestMatch.name,
            similarity: parseFloat((bestMatch.similarity * 100).toFixed(1)),
            threshold: parseFloat((bestMatch.threshold * 100).toFixed(1)),
            status: matchStatus,
            storedRegionConfig: bestMatch.storedRegionConfig || "full_image"
          },
          summary: {
            totalMatches: matchCount,
            totalFingerprints: excludeFingerprints.length,
            matchPercentage: parseFloat(((matchCount / excludeFingerprints.length) * 100).toFixed(1))
          }
        }
      };
      
      // Create formatted JSON display
      const formatJsonValue = (key, value, isLast = false) => {
        const comma = isLast ? '' : ',';
        
        if (typeof value === 'string') {
          if (key === 'status') {
            const statusClass = value === 'MATCH' ? 'match' : 'no-match';
            return `    <span class="json-key">"${key}"</span><span class="json-colon">:</span> <span class="json-boolean ${statusClass}">${value}</span>${comma}`;
          }
          return `    <span class="json-key">"${key}"</span><span class="json-colon">:</span> <span class="json-string">"${value}"</span>${comma}`;
        } else if (typeof value === 'number') {
          return `    <span class="json-key">"${key}"</span><span class="json-colon">:</span> <span class="json-number">${value}</span>${comma}`;
        } else if (typeof value === 'object' && value !== null) {
          const objStr = JSON.stringify(value, null, 2).replace(/\n/g, '\n      ');
          return `    <span class="json-key">"${key}"</span><span class="json-colon">:</span> <span class="json-object">${objStr}</span>${comma}`;
        }
        return `    <span class="json-key">"${key}"</span><span class="json-colon">:</span> ${value}${comma}`;
      };
      
      const jsonDisplay = `<span class="json-brace">{</span>
  <span class="json-key">"testImage"</span><span class="json-colon">:</span> <span class="json-string">"${jsonData.testImage}"</span>,
  <span class="json-key">"analysis"</span><span class="json-colon">:</span> <span class="json-brace">{</span>
    <span class="json-key">"bestMatch"</span><span class="json-colon">:</span> <span class="json-brace">{</span>
${formatJsonValue('name', jsonData.analysis.bestMatch.name)}
${formatJsonValue('similarity', jsonData.analysis.bestMatch.similarity)}
${formatJsonValue('threshold', jsonData.analysis.bestMatch.threshold)}
${formatJsonValue('status', jsonData.analysis.bestMatch.status)}
${formatJsonValue('storedRegionConfig', jsonData.analysis.bestMatch.storedRegionConfig, true)}
    <span class="json-brace">}</span>,
    <span class="json-key">"summary"</span><span class="json-colon">:</span> <span class="json-brace">{</span>
${formatJsonValue('totalMatches', jsonData.analysis.summary.totalMatches)}
${formatJsonValue('totalFingerprints', jsonData.analysis.summary.totalFingerprints)}
${formatJsonValue('matchPercentage', jsonData.analysis.summary.matchPercentage, true)}
    <span class="json-brace">}</span>
  <span class="json-brace">}</span>
<span class="json-brace">}</span>`;
      
      dialog.innerHTML = `
        <div class="similarity-test-header">
          Similarity Test Results
        </div>
        <div class="similarity-test-body">
          <div class="similarity-test-code-block">
            <pre class="json-line">${jsonDisplay}</pre>
          </div>
        </div>
        <div class="similarity-test-footer">
          <button id="closeTestDialog" class="similarity-test-close-btn">Close</button>
        </div>
      `;
      
      // Add backdrop
      const backdrop = document.createElement('div');
      backdrop.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 999;
      `;
      
      document.body.appendChild(backdrop);
      document.body.appendChild(dialog);
      
      // Close dialog handlers
      const closeDialog = () => {
        document.body.removeChild(dialog);
        document.body.removeChild(backdrop);
      };
      
      document.getElementById('closeTestDialog').onclick = closeDialog;
      backdrop.onclick = closeDialog;
      
      statusText.textContent = `Similarity test completed - ${matchStatus}`;
    } else {
      statusText.textContent = 'Failed to find any valid fingerprints for comparison';
    }
    
    // Reset status after delay
    setTimeout(() => {
      statusText.textContent = 'Ready';
    }, 5000);
    
  } catch (error) {
    console.error('Failed to run similarity test:', error);
    statusText.textContent = 'Error running similarity test';
  }
}

async function runSimilarityTestWithRegion(excludeFingerprints, testRegionConfig) {
  try {
    // Validate image path
    if (!currentImagePath) {
      statusText.textContent = 'Error: No image selected. Please select an image first.';
      return;
    }
    
    statusText.textContent = 'Calculating fingerprint and testing similarity...';
    
    // Calculate fingerprint for the test image with region configuration
    // Log the image path for debugging
    console.log('[Test Similarity] Using image path for fingerprint calculation:', currentImagePath);
    
    const result = await window.electronAPI.calculateImageSSIMFingerprint({
      imagePath: currentImagePath,
      store: false, // Don't store, just calculate for testing
      threshold: 0.95,
      regionConfig: testRegionConfig
    });
    
    if (result && result.success) {
      let bestMatch = null;
      let bestSimilarity = 0;
      let matchCount = 0;
      
      // Test against all existing fingerprints
      for (const excludeItem of excludeFingerprints) {
        try {
          // Load the stored fingerprint
          const storedResult = await window.electronAPI.loadFingerprintById(excludeItem.id);
          
          if (storedResult.success) {
            // Compare fingerprints
            const similarity = await window.electronAPI.compareSSIMFingerprints({
              fingerprint1: result.fingerprint,
              fingerprint2: storedResult.fingerprint
            });
            
            if (similarity.success) {
              const similarityValue = similarity.similarity;
              const threshold = excludeItem.threshold || 0.95;
              
              // Check if this is a match based on threshold
              if (similarityValue >= threshold) {
                matchCount++;
              }
              
              // Track best match
              if (similarityValue > bestSimilarity) {
                bestSimilarity = similarityValue;
                bestMatch = {
                  name: excludeItem.name || excludeItem.id,
                  similarity: similarityValue,
                  threshold: threshold,
                  isMatch: similarityValue >= threshold,
                  storedRegionConfig: storedResult.metadata?.fingerprint?.regionConfig
                };
              }
            }
          }
        } catch (error) {
          console.error(`Error testing against fingerprint ${excludeItem.id}:`, error);
        }
      }
      
      // Display results
      const imageName = currentImagePath.split('/').pop();
      if (bestMatch) {
        const matchStatus = bestMatch.isMatch ? 'MATCH' : 'NO MATCH';
        
        // Create enhanced results dialog with region information
        const dialog = document.createElement('div');
        dialog.className = 'similarity-test-dialog';
        
        // Format data as JSON-like structure with region info
        const jsonData = {
          testImage: imageName,
          testRegionConfig: testRegionConfig.enabled ? {
            width: testRegionConfig.width,
            height: testRegionConfig.height,
            alignment: testRegionConfig.alignment
          } : "full_image",
          analysis: {
            bestMatch: {
              name: bestMatch.name,
              similarity: parseFloat((bestMatch.similarity * 100).toFixed(1)),
              threshold: parseFloat((bestMatch.threshold * 100).toFixed(1)),
              status: matchStatus,
              storedRegionConfig: bestMatch.storedRegionConfig || "full_image"
            },
            summary: {
              totalMatches: matchCount,
              totalFingerprints: excludeFingerprints.length,
              matchPercentage: parseFloat(((matchCount / excludeFingerprints.length) * 100).toFixed(1))
            }
          }
        };
        
        // Create formatted JSON display
        const formatJsonValue = (key, value, isLast = false) => {
          const comma = isLast ? '' : ',';
          
          if (typeof value === 'string') {
            if (key === 'status') {
              const statusClass = value === 'MATCH' ? 'match' : 'no-match';
              return `    <span class="json-key">"${key}"</span><span class="json-colon">:</span> <span class="json-boolean ${statusClass}">${value}</span>${comma}`;
            }
            return `    <span class="json-key">"${key}"</span><span class="json-colon">:</span> <span class="json-string">"${value}"</span>${comma}`;
          } else if (typeof value === 'number') {
            return `    <span class="json-key">"${key}"</span><span class="json-colon">:</span> <span class="json-number">${value}</span>${comma}`;
          } else if (typeof value === 'object' && value !== null) {
            const objStr = JSON.stringify(value, null, 2).replace(/\n/g, '\n      ');
            return `    <span class="json-key">"${key}"</span><span class="json-colon">:</span> <span class="json-object">${objStr}</span>${comma}`;
          }
          return `    <span class="json-key">"${key}"</span><span class="json-colon">:</span> ${value}${comma}`;
        };
        
        const jsonDisplay = `<span class="json-brace">{</span>
  <span class="json-key">"testImage"</span><span class="json-colon">:</span> <span class="json-string">"${jsonData.testImage}"</span>,
  ${formatJsonValue('testRegionConfig', jsonData.testRegionConfig)}
  <span class="json-key">"analysis"</span><span class="json-colon">:</span> <span class="json-brace">{</span>
    <span class="json-key">"bestMatch"</span><span class="json-colon">:</span> <span class="json-brace">{</span>
${formatJsonValue('name', jsonData.analysis.bestMatch.name)}
${formatJsonValue('similarity', jsonData.analysis.bestMatch.similarity)}
${formatJsonValue('threshold', jsonData.analysis.bestMatch.threshold)}
${formatJsonValue('status', jsonData.analysis.bestMatch.status)}
${formatJsonValue('storedRegionConfig', jsonData.analysis.bestMatch.storedRegionConfig, true)}
    <span class="json-brace">}</span>,
    <span class="json-key">"summary"</span><span class="json-colon">:</span> <span class="json-brace">{</span>
${formatJsonValue('totalMatches', jsonData.analysis.summary.totalMatches)}
${formatJsonValue('totalFingerprints', jsonData.analysis.summary.totalFingerprints)}
${formatJsonValue('matchPercentage', jsonData.analysis.summary.matchPercentage, true)}
    <span class="json-brace">}</span>
  <span class="json-brace">}</span>
<span class="json-brace">}</span>`;
        
        dialog.innerHTML = `
          <div class="similarity-test-header">
            Similarity Test Results (Region-based)
          </div>
          <div class="similarity-test-body">
            <div class="similarity-test-code-block">
              <pre class="json-line">${jsonDisplay}</pre>
            </div>
          </div>
          <div class="similarity-test-footer">
            <button id="closeTestDialog" class="similarity-test-close-btn">Close</button>
          </div>
        `;
        
        // Add backdrop
        const backdrop = document.createElement('div');
        backdrop.style.cssText = `
          position: fixed; top: 0; left: 0; width: 100%; height: 100%;
          background: rgba(0,0,0,0.5); z-index: 999;
        `;
        
        document.body.appendChild(backdrop);
        document.body.appendChild(dialog);
        
        // Close dialog handlers
        const closeDialog = () => {
          document.body.removeChild(dialog);
          document.body.removeChild(backdrop);
        };
        
        document.getElementById('closeTestDialog').onclick = closeDialog;
        backdrop.onclick = closeDialog;
        
        statusText.textContent = `Similarity test completed - ${matchStatus}`;
      } else {
        statusText.textContent = 'Failed to find any valid fingerprints for comparison';
      }
      
      // Reset status after delay
      setTimeout(() => {
        statusText.textContent = 'Ready';
      }, 5000);
      
    } else {
      statusText.textContent = 'Failed to calculate test image fingerprint';
    }
  } catch (error) {
    console.error('Failed to run similarity test:', error);
    statusText.textContent = 'Error running similarity test';
  }
}

// Test preset fingerprints initialization - for debugging
async function testPresetFingerprints() {
  try {
    const info = await window.electronAPI.getPresetFingerprintsInfo();
    console.log('Preset Fingerprints Info:', info);
    
    if (info.success) {
      console.log(`Preset directory: ${info.presetDir}`);
      console.log(`Directory exists: ${info.dirExists}`);
      console.log(`Preset files found: ${info.presetFiles.length}`);
      console.log(`Current version: ${info.currentVersion}`);
      console.log(`Installed version: ${info.installedVersion}`);
      console.log(`Needs update: ${info.needsUpdate}`);
      
      if (info.presetFiles.length > 0) {
        console.log('Preset files:', info.presetFiles);
      }
    }
    
    // Also test preset configuration
    try {
      const configInfo = await window.electronAPI.getPresetConfig();
      console.log('Preset Config Info:', configInfo);
      
      if (configInfo.success) {
        console.log(`Config file path: ${configInfo.configPath}`);
        console.log(`Config file exists: ${configInfo.configExists}`);
        console.log(`Config content:`, configInfo.config);
        
        if (configInfo.config.presets) {
          const presetNames = Object.keys(configInfo.config.presets);
          console.log(`Configured presets: ${presetNames.join(', ')}`);
          
          presetNames.forEach(name => {
            const preset = configInfo.config.presets[name];
            console.log(`  - ${name}: ${preset.name} (threshold: ${preset.threshold})`);
          });
        }
      }
    } catch (configError) {
      console.warn('Failed to get preset config:', configError);
    }
    
  } catch (error) {
    console.error('Error testing preset fingerprints:', error);
  }
}

// Add to global scope for console testing
window.testPresetFingerprints = testPresetFingerprints;
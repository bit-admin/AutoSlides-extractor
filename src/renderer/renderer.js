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

// Post-processing elements
const enablePostProcessing = document.getElementById('enablePostProcessing');
const excludeHashesTable = document.getElementById('excludeHashesTable');
const excludeHashesTableBody = document.getElementById('excludeHashesTableBody');
const btnSelectImageHash = document.getElementById('btnSelectImageHash');
const btnAddCustomHash = document.getElementById('btnAddCustomHash');
const btnSelectSlidesDir = document.getElementById('btnSelectSlidesDir');
const btnRunPostProcess = document.getElementById('btnRunPostProcess');

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
let excludeHashes = ['c27e1de6798fc280']; // Default exclude hash
let selectedSlidesDir = '';

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

    // Load post-processing settings
    enablePostProcessing.checked = config.enablePostProcessing !== false;
    
    // Handle both old format (string array) and new format (object array)
    const defaultExcludeHashes = []; // Start with empty array for testing
    if (config.excludeHashes) {
      if (Array.isArray(config.excludeHashes) && config.excludeHashes.length > 0) {
        if (typeof config.excludeHashes[0] === 'string') {
          // Convert old format to new format
          excludeHashes = config.excludeHashes.map(hash => ({ hash, threshold: 0 }));
        } else {
          // Already in new format
          excludeHashes = config.excludeHashes;
        }
      } else {
        excludeHashes = defaultExcludeHashes;
      }
    } else {
      excludeHashes = defaultExcludeHashes;
    }
    
    updateExcludeHashesList();
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
btnSelectImageHash.addEventListener('click', async () => {
  try {
    const imagePath = await window.electronAPI.selectImageFile();
    if (imagePath) {
      statusText.textContent = 'Calculating image hash...';
      const result = await window.electronAPI.calculateImageHash(imagePath);
      if (result && result.hash) {
        addExcludeHash(result.hash);
        statusText.textContent = `Hash calculated and added: ${result.hash}`;
        setTimeout(() => {
          statusText.textContent = 'Ready';
        }, 3000);
      } else {
        statusText.textContent = 'Failed to calculate image hash';
      }
    }
  } catch (error) {
    console.error('Failed to calculate image hash:', error);
    statusText.textContent = 'Error calculating image hash';
  }
});

btnAddCustomHash.addEventListener('click', () => {
  addNewExcludeHash();
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
  
  if (excludeHashes.length === 0) {
    statusText.textContent = 'No exclude hashes configured';
    return;
  }
  
  try {
    btnRunPostProcess.disabled = true;
    statusText.textContent = 'Running post-processing...';
    
    const result = await window.electronAPI.postProcessSlides(selectedSlidesDir, excludeHashes);
    
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
  
  // Load post-processing settings into modal controls
  const modalEnablePostProcessing = advancedSettingsModal.querySelector('#enablePostProcessing');
  
  if (modalEnableMultiCore) modalEnableMultiCore.checked = enableMultiCore.checked;
  if (modalHammingThreshold) modalHammingThreshold.value = hammingThreshold.value;
  if (modalSsimThreshold) modalSsimThreshold.value = ssimThreshold.value;
  if (modalPixelChangeRatioThreshold) modalPixelChangeRatioThreshold.value = pixelChangeRatioThreshold.value;
  if (modalVerificationCount) modalVerificationCount.value = verificationCount.value;
  if (modalSizeIdenticalThreshold) modalSizeIdenticalThreshold.value = sizeIdenticalThreshold.value;
  if (modalSizeDiffThreshold) modalSizeDiffThreshold.value = sizeDiffThreshold.value;
  if (modalEnablePostProcessing) modalEnablePostProcessing.checked = enablePostProcessing.checked;
  
  // Update exclude hashes list in modal
  updateExcludeHashesList();
  
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
    if (modalSizeDiffThreshold) sizeDiffThreshold.value = modalSizeDiffThreshold.value;
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
      enablePostProcessing: enablePostProcessing.checked,
      excludeHashes: excludeHashes
    };
    
    await window.electronAPI.saveConfig(config);
  } catch (error) {
    console.error('Failed to save configuration:', error);
  }
}

// Post-processing utility functions
function updateExcludeHashesList() {
  const tableBody = document.getElementById('excludeHashesTableBody');
  tableBody.innerHTML = '';
  
  excludeHashes.forEach((excludeItem, index) => {
    const row = document.createElement('tr');
    row.setAttribute('data-index', index);
    
    // Hash value cell
    const hashCell = document.createElement('td');
    hashCell.className = 'hash-cell';
    
    const hashDisplay = document.createElement('div');
    hashDisplay.className = 'hash-display';
    const hashValue = typeof excludeItem === 'string' ? excludeItem : excludeItem.hash;
    
    if (hashValue) {
      hashDisplay.textContent = hashValue;
      hashDisplay.title = 'Click to edit';
    } else {
      hashDisplay.textContent = 'Enter hash value...';
      hashDisplay.className = 'hash-display empty';
      hashDisplay.title = 'Click to add hash';
    }
    
    hashCell.appendChild(hashDisplay);
    
    // Threshold cell  
    const thresholdCell = document.createElement('td');
    thresholdCell.className = 'threshold-cell';
    
    const thresholdDisplay = document.createElement('div');
    thresholdDisplay.className = 'threshold-display';
    const thresholdValue = typeof excludeItem === 'object' ? excludeItem.threshold : 0;
    thresholdDisplay.textContent = thresholdValue.toString();
    thresholdDisplay.title = 'Click to edit threshold';
    
    thresholdCell.appendChild(thresholdDisplay);
    
    // Actions cell
    const actionsCell = document.createElement('td');
    actionsCell.className = 'actions-cell';
    
    // Edit button with SVG icon
    const editBtn = document.createElement('button');
    editBtn.className = 'row-action-button';
    editBtn.title = 'Edit hash';
    editBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    `;
    editBtn.onclick = () => editExcludeHash(index);
    
    // Delete button with SVG icon
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'row-action-button delete';
    deleteBtn.title = 'Remove hash';
    deleteBtn.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3,6 5,6 21,6"/>
        <path d="M19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2v2"/>
        <line x1="10" y1="11" x2="10" y2="17"/>
        <line x1="14" y1="11" x2="14" y2="17"/>
      </svg>
    `;
    deleteBtn.onclick = () => removeExcludeHash(index);
    
    actionsCell.appendChild(editBtn);
    actionsCell.appendChild(deleteBtn);
    
    row.appendChild(hashCell);
    row.appendChild(thresholdCell);
    row.appendChild(actionsCell);
    tableBody.appendChild(row);
  });
  
  // Add empty state row if no hashes
  if (excludeHashes.length === 0) {
    const emptyRow = document.createElement('tr');
    const emptyCell = document.createElement('td');
    emptyCell.colSpan = 3;
    emptyCell.className = 'hash-empty';
    emptyCell.textContent = 'No exclude hashes configured';
    emptyCell.style.textAlign = 'center';
    emptyCell.style.color = '#6c757d';
    emptyCell.style.fontStyle = 'italic';
    emptyCell.style.padding = '20px';
    emptyRow.appendChild(emptyCell);
    tableBody.appendChild(emptyRow);
  }
}

function addExcludeHash(hash) {
  // Check if hash already exists
  const existingIndex = excludeHashes.findIndex(item => 
    (typeof item === 'string' ? item : item.hash) === hash
  );
  
  if (existingIndex === -1) {
    excludeHashes.push({ hash: hash, threshold: 0 }); // Default threshold is 0
    updateExcludeHashesList();
    // Auto-save configuration
    saveConfig();
  }
}

function removeExcludeHash(index) {
  if (index >= 0 && index < excludeHashes.length) {
    const hashValue = typeof excludeHashes[index] === 'string' ? excludeHashes[index] : excludeHashes[index].hash;
    
    excludeHashes.splice(index, 1);
    updateExcludeHashesList();
    
    // Only save config if we're removing a valid hash (not an empty one)
    if (hashValue) {
      saveConfig();
    }
  }
}

function editExcludeHash(index) {
  if (index >= 0 && index < excludeHashes.length) {
    const tableBody = document.getElementById('excludeHashesTableBody');
    const row = tableBody.querySelector(`tr[data-index="${index}"]`);
    
    if (row) {
      // Toggle editing state
      if (row.classList.contains('editing')) {
        // Save changes
        saveHashEdit(index, row);
      } else {
        // Enter edit mode
        enterEditMode(index, row);
      }
    }
  }
}

function enterEditMode(index, row) {
  const currentHash = typeof excludeHashes[index] === 'string' ? excludeHashes[index] : excludeHashes[index].hash;
  const currentThreshold = typeof excludeHashes[index] === 'object' ? excludeHashes[index].threshold : 0;
  
  // Mark row as editing
  row.classList.add('editing');
  
  // Replace hash display with input
  const hashCell = row.querySelector('.hash-cell');
  const hashDisplay = hashCell.querySelector('.hash-display');
  
  const hashInput = document.createElement('input');
  hashInput.type = 'text';
  hashInput.className = 'hash-input';
  hashInput.value = currentHash || '';
  hashInput.maxLength = 16;
  hashInput.placeholder = 'Enter 16-chars hash';
  
  hashCell.innerHTML = '';
  hashCell.appendChild(hashInput);
  
  // Replace threshold display with input
  const thresholdCell = row.querySelector('.threshold-cell');
  const thresholdDisplay = thresholdCell.querySelector('.threshold-display');
  
  const thresholdInput = document.createElement('input');
  thresholdInput.type = 'number';
  thresholdInput.className = 'threshold-input-edit';
  thresholdInput.value = currentThreshold;
  thresholdInput.min = '0';
  thresholdInput.max = '64';
  thresholdInput.step = '1';
  thresholdInput.placeholder = 'Threshold';
  
  thresholdCell.innerHTML = '';
  thresholdCell.appendChild(thresholdInput);
  
  // Update buttons in actions cell
  const actionsCell = row.querySelector('.actions-cell');
  const editBtn = actionsCell.querySelector('.row-action-button:first-child');
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
  
  // Focus the hash input
  hashInput.focus();
  hashInput.select();
  
  // Handle Enter key to save
  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      saveHashEdit(index, row);
    } else if (e.key === 'Escape') {
      cancelHashEdit(index, row);
    }
  };
  
  hashInput.addEventListener('keypress', handleKeyPress);
  thresholdInput.addEventListener('keypress', handleKeyPress);
}

function saveHashEdit(index, row) {
  const hashInput = row.querySelector('.hash-input');
  const thresholdInput = row.querySelector('.threshold-input-edit');
  
  const newHash = hashInput.value.toLowerCase().trim();
  const newThreshold = parseInt(thresholdInput.value) || 0;
  
  // Validate hash
  if (newHash.length !== 16 || !/^[0-9a-f]+$/.test(newHash)) {
    alert('Please enter a valid 16-character hexadecimal hash value');
    hashInput.focus();
    return;
  }
  
  // Validate threshold
  if (newThreshold < 0 || newThreshold > 64) {
    alert('Threshold must be between 0 and 64');
    thresholdInput.focus();
    return;
  }
  
  // Check if hash already exists (excluding current index)
  const existingIndex = excludeHashes.findIndex((item, idx) => 
    idx !== index && (typeof item === 'string' ? item : item.hash) === newHash
  );
  
  if (existingIndex !== -1) {
    alert('This hash already exists in the exclude list');
    hashInput.focus();
    return;
  }
  
  // Update the hash and threshold
  excludeHashes[index] = { hash: newHash, threshold: newThreshold };
  
  // Exit edit mode and refresh
  exitEditMode(row);
  updateExcludeHashesList();
  saveConfig();
}

function cancelHashEdit(index, row) {
  exitEditMode(row);
  updateExcludeHashesList();
}

function exitEditMode(row) {
  row.classList.remove('editing');
}

function addNewExcludeHash() {
  // Add a new empty hash entry for editing
  const newHash = { hash: '', threshold: 0 };
  const newIndex = excludeHashes.length;
  excludeHashes.push(newHash);
  
  // Update the list to show the new row
  updateExcludeHashesList();
  
  // Immediately enter edit mode for the new row
  setTimeout(() => {
    const tableBody = document.getElementById('excludeHashesTableBody');
    const newRow = tableBody.querySelector(`tr[data-index="${newIndex}"]`);
    if (newRow) {
      enterEditMode(newIndex, newRow);
    }
  }, 10);
}

// Automatic post-processing after video completion
async function runAutomaticPostProcessing(slidesDir) {
  if (!enablePostProcessing.checked || excludeHashes.length === 0) {
    return { success: true, skipped: true };
  }
  
  try {
    statusText.textContent = 'Running automatic post-processing...';
    const result = await window.electronAPI.postProcessSlides(slidesDir, excludeHashes);
    
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
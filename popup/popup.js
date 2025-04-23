/**
 * Link Previewer - Popup Script
 * Handles the popup functionality and user settings
 */

// Default settings
const DEFAULT_SETTINGS = {
  enabled: true,
  hoverDelay: 500
};

// DOM elements
const enabledToggle = document.getElementById('enabled-toggle');
const delaySlider = document.getElementById('delay-slider');
const delayValue = document.getElementById('delay-value');

/**
 * Initialize popup
 */
function initPopup() {
  // Load saved settings
  loadSettings().then(settings => {
    // Update UI with settings
    enabledToggle.checked = settings.enabled;
    delaySlider.value = settings.hoverDelay;
    delayValue.textContent = `${settings.hoverDelay}ms`;
    
    // Add event listeners
    setupEventListeners();
  });
}

/**
 * Load settings from storage
 * @returns {Promise<Object>} - Settings object
 */
function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get('linkPreviewerSettings', result => {
      const settings = result.linkPreviewerSettings || DEFAULT_SETTINGS;
      resolve(settings);
    });
  });
}

/**
 * Save settings to storage
 * @param {Object} settings - Settings to save
 */
function saveSettings(settings) {
  return new Promise(resolve => {
    chrome.storage.sync.set({ 'linkPreviewerSettings': settings }, () => {
      resolve();
    });
  });
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Handle toggle change
  enabledToggle.addEventListener('change', async () => {
    const settings = await loadSettings();
    settings.enabled = enabledToggle.checked;
    
    // Save updated settings
    await saveSettings(settings);
    
    // Notify content script of changes
    notifySettingsChanged(settings);
  });
  
  // Handle delay slider change
  delaySlider.addEventListener('input', () => {
    // Update display value
    delayValue.textContent = `${delaySlider.value}ms`;
  });
  
  // Handle delay slider release
  delaySlider.addEventListener('change', async () => {
    const settings = await loadSettings();
    settings.hoverDelay = parseInt(delaySlider.value, 10);
    
    // Save updated settings
    await saveSettings(settings);
    
    // Notify content script of changes
    notifySettingsChanged(settings);
  });
}

/**
 * Notify content scripts of settings changes
 * @param {Object} settings - Updated settings
 */
function notifySettingsChanged(settings) {
  // Query all tabs
  chrome.tabs.query({}, tabs => {
    // Send message to all tabs
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, { 
        action: 'settingsChanged', 
        settings: settings 
      }).catch(() => {
        // Ignore errors for tabs where content script isn't loaded
      });
    });
  });
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', initPopup); 
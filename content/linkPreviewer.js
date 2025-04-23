/**
 * Link Previewer - Content Script
 * Detects links on webpages and shows previews on hover
 */

// Debug mode for troubleshooting
const DEBUG = true;

// Log helper for debugging
function debugLog(...args) {
  if (DEBUG) {
    console.log('[Link Previewer]', ...args);
  }
}

// Configuration options
const CONFIG = {
  hoverDelay: 500,        // Delay before showing preview (ms)
  fadeInDuration: 300,    // Animation duration for showing preview (ms)
  fadeOutDuration: 200,   // Animation duration for hiding preview (ms)
  maxCacheSize: 50,       // Maximum number of previews to cache
  previewWidth: 320,      // Preview window width (px)
  previewHeight: 180,     // Preview window height (px)
  maxTitleLength: 80,     // Maximum characters for title
  maxDescriptionLength: 150, // Maximum characters for description
  offsetX: 10,            // Horizontal offset from cursor (px)
  offsetY: 10             // Vertical offset from cursor (px)
};

// User settings
let userSettings = {
  enabled: true,
  hoverDelay: CONFIG.hoverDelay
};

// Cache for storing fetched previews
const previewCache = new Map();

// Track current hover state
let currentHoverState = {
  link: null,
  timer: null,
  previewElement: null,
  isPreviewVisible: false
};

/**
 * Initialize the link previewer functionality
 */
function initLinkPreviewer() {
  try {
    debugLog('Initializing Link Previewer');
    
    // Load user settings
    loadSettings().then(() => {
      try {
        // Create preview container that will be reused
        createPreviewContainer();
        
        // Find all links on the page
        const links = document.querySelectorAll('a[href]');
        debugLog(`Found ${links.length} links on the page`);
        
        // Add event listeners to each link
        links.forEach(link => {
          addLinkEventListeners(link);
        });
        
        // Watch for dynamically added links using MutationObserver
        observeDynamicLinks();
        
        // Listen for settings changes
        setupMessageListener();
        
        debugLog('Link Previewer initialization complete');
      } catch (error) {
        console.error('Error during Link Previewer initialization:', error);
      }
    });
  } catch (error) {
    console.error('Failed to initialize Link Previewer:', error);
  }
}

/**
 * Load settings from storage
 * @returns {Promise<void>}
 */
async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.sync.get('linkPreviewerSettings', result => {
      if (result.linkPreviewerSettings) {
        userSettings = { ...userSettings, ...result.linkPreviewerSettings };
        // Update CONFIG based on userSettings
        CONFIG.hoverDelay = userSettings.hoverDelay;
      }
      resolve();
    });
  });
}

/**
 * Set up message listener for settings changes
 */
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'settingsChanged') {
      // Update settings
      userSettings = { ...userSettings, ...message.settings };
      
      // Update CONFIG based on userSettings
      CONFIG.hoverDelay = userSettings.hoverDelay;
      
      sendResponse({ success: true });
    }
    return true;
  });
}

/**
 * Creates the container element for previews
 */
function createPreviewContainer() {
  // Check if container already exists
  if (document.getElementById('link-previewer-container')) {
    return;
  }
  
  // Create container element
  const container = document.createElement('div');
  container.id = 'link-previewer-container';
  container.className = 'link-previewer-hidden';
  
  // Create inner structure
  container.innerHTML = `
    <div class="link-previewer-header">
      <img class="link-previewer-favicon" src="" alt="">
      <span class="link-previewer-domain"></span>
    </div>
    <div class="link-previewer-image-container">
      <img class="link-previewer-image" src="" alt="">
    </div>
    <div class="link-previewer-content">
      <h3 class="link-previewer-title"></h3>
      <p class="link-previewer-description"></p>
    </div>
    <div class="link-previewer-footer">
      <span class="link-previewer-url"></span>
    </div>
  `;
  
  // Add to document
  document.body.appendChild(container);
  currentHoverState.previewElement = container;
}

/**
 * Add mouse event listeners to a link
 * @param {HTMLAnchorElement} link - The link element to attach listeners to
 */
function addLinkEventListeners(link) {
  // Ignore links without href or with javascript: URLs
  const href = link.href;
  if (!href || href.startsWith('javascript:')) {
    return;
  }
  
  // Add mouseenter event
  link.addEventListener('mouseenter', (event) => {
    // Skip if disabled
    if (!userSettings.enabled) return;
    
    handleLinkMouseEnter(link, event);
  });
  
  // Add mouseleave event
  link.addEventListener('mouseleave', () => {
    handleLinkMouseLeave();
  });
  
  // Add mousemove event to update position
  link.addEventListener('mousemove', (event) => {
    updatePreviewPosition(event);
  });
}

/**
 * Handles mouse entering a link
 * @param {HTMLAnchorElement} link - The link being hovered
 * @param {MouseEvent} event - The mouse event
 */
function handleLinkMouseEnter(link, event) {
  // Clear any existing timers
  if (currentHoverState.timer) {
    clearTimeout(currentHoverState.timer);
  }
  
  // Store current link
  currentHoverState.link = link;
  
  // Set timer to show preview after delay
  currentHoverState.timer = setTimeout(() => {
    showLinkPreview(link, event);
  }, CONFIG.hoverDelay);
}

/**
 * Handles mouse leaving a link
 */
function handleLinkMouseLeave() {
  // Clear timer if it exists
  if (currentHoverState.timer) {
    clearTimeout(currentHoverState.timer);
    currentHoverState.timer = null;
  }
  
  // Hide preview if visible
  if (currentHoverState.isPreviewVisible) {
    hidePreview();
  }
}

/**
 * Shows the preview for a link
 * @param {HTMLAnchorElement} link - The link to show preview for
 * @param {MouseEvent} event - The mouse event
 */
async function showLinkPreview(link, event) {
  const url = link.href;
  
  // Skip invalid URLs
  if (!isValidUrl(url)) {
    debugLog('Skipping invalid URL:', url);
    return;
  }
  
  debugLog('Showing preview for:', url);
  
  try {
    // Get preview data (from cache or fetch new)
    const previewData = await getPreviewData(url);
    
    // Update preview container with data
    updatePreviewContent(previewData);
    
    // Position the preview
    updatePreviewPosition(event);
    
    // Show the preview with animation
    showPreviewElement();
  } catch (error) {
    console.error('Failed to generate preview:', error);
  }
}

/**
 * Updates the preview container with content
 * @param {Object} previewData - The data for the preview
 */
function updatePreviewContent(previewData) {
  if (!currentHoverState.previewElement) return;
  
  const container = currentHoverState.previewElement;
  debugLog('Updating preview content with data:', previewData);
  
  try {
    // Update title with animation
    const titleElement = container.querySelector('.link-previewer-title');
    titleElement.textContent = truncateText(previewData.title || previewData.domain, CONFIG.maxTitleLength);
    titleElement.style.animation = 'fadeIn 0.3s ease-out';
    
    // Update description with staggered animation
    const descriptionElement = container.querySelector('.link-previewer-description');
    descriptionElement.textContent = truncateText(previewData.description || `Content from ${previewData.domain}`, CONFIG.maxDescriptionLength);
    descriptionElement.style.animation = 'fadeIn 0.3s ease-out 0.1s forwards';
    descriptionElement.style.opacity = '0';
    
    // Update domain info
    const domainElement = container.querySelector('.link-previewer-domain');
    domainElement.textContent = previewData.domain || '';
    
    // Update favicon with subtle animation
    const faviconElement = container.querySelector('.link-previewer-favicon');
    faviconElement.src = previewData.favicon || '';
    faviconElement.style.display = previewData.favicon ? 'inline' : 'none';
    if (previewData.favicon) {
      faviconElement.style.animation = 'fadeIn 0.3s ease-out';
    }
    
    // Update image
    const imageElement = container.querySelector('.link-previewer-image');
    const imageContainer = container.querySelector('.link-previewer-image-container');
    
    if (previewData.image) {
      imageElement.src = previewData.image;
      imageContainer.style.display = 'block';
      imageElement.style.animation = 'fadeIn 0.5s ease-out';
      
      // Handle image errors
      imageElement.onerror = () => {
        debugLog('Image failed to load:', previewData.image);
        imageContainer.style.display = 'none';
      };
      
      // Add load event to apply subtle zoom effect
      imageElement.onload = () => {
        setTimeout(() => {
          imageElement.style.transform = 'scale(1.03)';
          imageElement.style.transition = 'transform 4s ease';
        }, 500);
      };
    } else {
      imageContainer.style.display = 'none';
    }
    
    // Update URL with animation
    const urlElement = container.querySelector('.link-previewer-url');
    urlElement.textContent = previewData.url || '';
    urlElement.style.animation = 'fadeIn 0.3s ease-out 0.2s forwards';
    urlElement.style.opacity = '0';
    
    debugLog('Preview content updated successfully');
  } catch (error) {
    console.error('Error updating preview content:', error);
  }
}

/**
 * Updates the position of the preview
 * @param {MouseEvent} event - The mouse event
 */
function updatePreviewPosition(event) {
  if (!currentHoverState.previewElement || !currentHoverState.isPreviewVisible) {
    return;
  }
  
  const container = currentHoverState.previewElement;
  const containerRect = container.getBoundingClientRect();
  
  // Calculate position
  let x = event.clientX + CONFIG.offsetX;
  let y = event.clientY + CONFIG.offsetY;
  
  // Adjust if preview would go outside viewport
  if (x + containerRect.width > window.innerWidth) {
    x = event.clientX - containerRect.width - CONFIG.offsetX;
  }
  
  if (y + containerRect.height > window.innerHeight) {
    y = event.clientY - containerRect.height - CONFIG.offsetY;
  }
  
  // Set position
  container.style.left = `${x}px`;
  container.style.top = `${y}px`;
}

/**
 * Shows the preview element with animation
 */
function showPreviewElement() {
  if (!currentHoverState.previewElement) return;
  
  const container = currentHoverState.previewElement;
  debugLog('Showing preview element');
  
  // Force any necessary style reflows to ensure animation works
  container.style.display = 'block';
  
  // Apply pulse animation to the container
  container.style.animation = 'pulse 2s infinite';
  
  // Small delay to ensure display takes effect before changing classes
  setTimeout(() => {
    // Remove hidden class and add visible class
    container.classList.remove('link-previewer-hidden');
    container.classList.add('link-previewer-visible');
    
    // Add a subtle scale effect to image on hover
    const image = container.querySelector('.link-previewer-image');
    if (image && image.src) {
      image.style.transform = 'scale(1.03)';
      image.style.transition = 'transform 4s ease';
    }
    
    // Mark as visible
    currentHoverState.isPreviewVisible = true;
    
    debugLog('Preview element should now be visible');
  }, 10);
}

/**
 * Hides the preview with animation
 */
function hidePreview() {
  if (!currentHoverState.previewElement) return;
  
  const container = currentHoverState.previewElement;
  debugLog('Hiding preview');
  
  // Stop the pulse animation
  container.style.animation = '';
  
  // Reset image scale effect
  const image = container.querySelector('.link-previewer-image');
  if (image) {
    image.style.transform = '';
  }
  
  // Add hidden class and remove visible class
  container.classList.remove('link-previewer-visible');
  container.classList.add('link-previewer-hidden');
  
  // Mark as not visible
  currentHoverState.isPreviewVisible = false;
}

/**
 * Gets preview data for a URL, using cache if available
 * @param {string} url - The URL to get preview for
 * @returns {Promise<Object>} - Preview data
 */
async function getPreviewData(url) {
  // Check cache first
  if (previewCache.has(url)) {
    return previewCache.get(url);
  }
  
  // Fetch new preview data
  try {
    const previewData = await fetchPreviewData(url);
    
    // Cache the result
    cachePreviewData(url, previewData);
    
    return previewData;
  } catch (error) {
    console.error('Error fetching preview:', error);
    
    // Return fallback data on error
    return createFallbackPreviewData(url);
  }
}

/**
 * Fetches preview data from a URL
 * @param {string} url - The URL to fetch preview for
 * @returns {Promise<Object>} - Preview data
 */
async function fetchPreviewData(url) {
  try {
    debugLog('Fetching preview data for:', url);
    
    // Send message to background script to handle cross-origin request
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { action: 'fetchPreview', url: url },
        response => {
          if (chrome.runtime.lastError) {
            debugLog('Runtime error:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          
          if (response && response.data) {
            debugLog('Received preview data:', response.data);
            resolve(response.data);
          } else {
            debugLog('Failed to fetch preview:', response?.error);
            reject(new Error(response?.error || 'Failed to fetch preview'));
          }
        }
      );
    });
  } catch (error) {
    console.error('Error in fetchPreviewData:', error);
    throw error;
  }
}

/**
 * Creates fallback preview data for a URL
 * @param {string} url - The URL
 * @returns {Object} - Basic preview data
 */
function createFallbackPreviewData(url) {
  const domain = extractDomain(url);
  const favicon = `https://www.google.com/s2/favicons?domain=${domain}`;
  
  return {
    url: url,
    domain: domain,
    title: domain,
    description: 'Preview not available',
    image: null,
    favicon: favicon
  };
}

/**
 * Caches preview data with LRU eviction
 * @param {string} url - The URL as key
 * @param {Object} data - The preview data
 */
function cachePreviewData(url, data) {
  // Implement LRU cache - if cache is full, remove oldest entry
  if (previewCache.size >= CONFIG.maxCacheSize) {
    const oldestKey = previewCache.keys().next().value;
    previewCache.delete(oldestKey);
  }
  
  // Add to cache
  previewCache.set(url, data);
}

/**
 * Observes DOM for dynamically added links
 */
function observeDynamicLinks() {
  // Create MutationObserver to watch for new links
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      // Check added nodes for links
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // If node is an element, find all links within it
          const links = node.querySelectorAll('a[href]');
          links.forEach(link => {
            addLinkEventListeners(link);
          });
          
          // Check if the node itself is a link
          if (node.tagName === 'A' && node.href) {
            addLinkEventListeners(node);
          }
        }
      });
    });
  });
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * Extracts domain from URL
 * @param {string} url - The URL
 * @returns {string} - The domain
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch (e) {
    // Fallback for invalid URLs
    return url.split('/')[2] || url;
  }
}

/**
 * Checks if a string is a valid URL
 * @param {string} url - The URL to check
 * @returns {boolean} - True if valid
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Truncates text to specified length
 * @param {string} text - The text to truncate
 * @param {number} maxLength - Maximum length
 * @returns {string} - Truncated text
 */
function truncateText(text, maxLength) {
  if (!text) return '';
  
  if (text.length <= maxLength) {
    return text;
  }
  
  return text.substring(0, maxLength - 3) + '...';
}

// Initialize once DOM is fully loaded
if (document.readyState === 'loading') {
  debugLog('Document still loading, waiting for DOMContentLoaded');
  document.addEventListener('DOMContentLoaded', initLinkPreviewer);
} else {
  debugLog('Document already loaded, initializing immediately');
  initLinkPreviewer();
} 
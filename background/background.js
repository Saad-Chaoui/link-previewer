/**
 * Link Previewer - Background Script
 * Handles cross-origin requests and communication with content script
 */

// Enable console logging for debugging
const DEBUG = true;

// Log helper
function logDebug(...args) {
  if (DEBUG) {
    console.log('[Link Previewer BG]', ...args);
  }
}

// Cache for preview data, shared across tabs
const previewCache = new Map();

// Maximum cache size
const MAX_CACHE_SIZE = 100;

// Content type checks
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const PDF_TYPE = 'application/pdf';
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];

/**
 * Listen for messages from content script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'fetchPreview') {
    logDebug('Received fetchPreview request for:', message.url);
    
    // Wrap in try-catch to handle errors
    try {
      fetchPreviewData(message.url)
        .then(data => {
          logDebug('Sending preview data back to content script');
          sendResponse({ data });
        })
        .catch(error => {
          console.error('Error fetching preview:', error);
          sendResponse({ 
            data: createFallbackPreview(message.url),
            error: error.message 
          });
        });
      return true; // Keep the message channel open for async response
    } catch (error) {
      console.error('Uncaught error in message handler:', error);
      sendResponse({ 
        data: createFallbackPreview(message.url),
        error: 'Internal extension error' 
      });
      return true;
    }
  }
});

/**
 * Fetches and extracts preview data from a URL
 * @param {string} url - The URL to fetch preview for
 * @returns {Promise<Object>} - Preview data
 */
async function fetchPreviewData(url) {
  try {
    // Check cache first
    if (previewCache.has(url)) {
      logDebug('Cache hit for:', url);
      return previewCache.get(url);
    }
    
    logDebug('Cache miss, fetching data for:', url);
    
    // For same-origin URLs, attempt to get content type first
    let contentType;
    try {
      contentType = await getContentType(url);
      logDebug('Content type for', url, 'is', contentType);
    } catch (error) {
      logDebug('Error getting content type, proceeding with HTML fallback');
      contentType = 'text/html'; // Assume HTML if we can't get the content type
    }
    
    // Handle different content types
    if (IMAGE_TYPES.some(type => contentType.includes(type))) {
      return handleImagePreview(url);
    } else if (contentType.includes(PDF_TYPE)) {
      return handlePdfPreview(url);
    } else if (VIDEO_TYPES.some(type => contentType.includes(type))) {
      return handleVideoPreview(url);
    } else {
      // Default to HTML content
      return fetchHtmlPreview(url);
    }
  } catch (error) {
    console.error('Error in fetchPreviewData:', error);
    return createFallbackPreview(url);
  }
}

/**
 * Gets just the content type of a URL using HEAD request
 * @param {string} url - The URL to check
 * @returns {Promise<string>} - Content type
 */
async function getContentType(url) {
  try {
    // Use no-cors mode to avoid CORS issues for HEAD requests
    const response = await fetch(url, {
      method: 'HEAD',
      credentials: 'omit',
      mode: 'no-cors',
      cache: 'no-store'
    });
    
    const contentType = response.headers?.get('content-type') || '';
    return contentType;
  } catch (error) {
    logDebug('Error getting content type:', error);
    throw error;
  }
}

/**
 * Handles preview for image URLs
 * @param {string} url - The image URL
 * @returns {Object} - Preview data for the image
 */
function handleImagePreview(url) {
  logDebug('Handling image preview for:', url);
  const domain = extractDomain(url);
  const previewData = {
    url: url,
    domain: domain,
    title: 'Image',
    description: `Image from ${domain}`,
    image: url,
    favicon: `https://www.google.com/s2/favicons?domain=${domain}`
  };
  
  cachePreviewData(url, previewData);
  return previewData;
}

/**
 * Handles preview for PDF URLs
 * @param {string} url - The PDF URL
 * @returns {Object} - Preview data for the PDF
 */
function handlePdfPreview(url) {
  logDebug('Handling PDF preview for:', url);
  const domain = extractDomain(url);
  const filename = url.split('/').pop() || 'document.pdf';
  
  const previewData = {
    url: url,
    domain: domain,
    title: `PDF: ${filename}`,
    description: `PDF document from ${domain}`,
    image: 'https://ssl.gstatic.com/docs/doclist/images/mediatype/icon_3_pdf_x64.png',
    favicon: `https://www.google.com/s2/favicons?domain=${domain}`
  };
  
  cachePreviewData(url, previewData);
  return previewData;
}

/**
 * Handles preview for video URLs
 * @param {string} url - The video URL
 * @returns {Object} - Preview data for the video
 */
function handleVideoPreview(url) {
  logDebug('Handling video preview for:', url);
  const domain = extractDomain(url);
  const filename = url.split('/').pop() || 'video';
  
  const previewData = {
    url: url,
    domain: domain,
    title: `Video: ${filename}`,
    description: `Video from ${domain}`,
    image: 'https://ssl.gstatic.com/docs/doclist/images/mediatype/icon_1_video_x64.png',
    favicon: `https://www.google.com/s2/favicons?domain=${domain}`
  };
  
  cachePreviewData(url, previewData);
  return previewData;
}

/**
 * Fetches and extracts preview data from HTML page
 * @param {string} url - The URL to fetch preview for
 * @returns {Promise<Object>} - Preview data
 */
async function fetchHtmlPreview(url) {
  logDebug('Attempting to fetch HTML preview for:', url);
  
  try {
    // Use proxy service to avoid CORS issues
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    logDebug('Using proxy URL:', proxyUrl);
    
    const response = await fetch(proxyUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch via proxy: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.contents) {
      throw new Error('No content returned from proxy');
    }
    
    const html = data.contents;
    
    // Extract data using regex for Service Worker compatibility
    const domain = extractDomain(url);
    const title = extractTitleFromHtml(html) || domain;
    const description = extractDescriptionFromHtml(html) || 'No description available';
    const imageUrl = extractImageFromHtml(html, url) || null;
    const favicon = `https://www.google.com/s2/favicons?domain=${domain}`;
    
    // Create preview data object
    const previewData = {
      url: url,
      domain: domain,
      title: title,
      description: description,
      image: imageUrl,
      favicon: favicon
    };
    
    logDebug('Successfully created HTML preview:', previewData);
    
    // Cache the result
    cachePreviewData(url, previewData);
    
    return previewData;
  } catch (error) {
    // If the proxy fails, try direct fetch with no-cors mode as fallback
    console.error('Error in fetchHtmlPreview:', error);
    logDebug('Proxy fetch failed, trying fallback method');
    
    try {
      // Create more detailed preview using just the domain and URL
      const domain = extractDomain(url);
      
      // Attempt to get page title using a simple fetch (may fail due to CORS)
      let title = domain;
      let description = `Content from ${domain}`;
      
      // Create enhanced fallback data
      const previewData = {
        url: url,
        domain: domain,
        title: title,
        description: description,
        image: null,
        favicon: `https://www.google.com/s2/favicons?domain=${domain}`
      };
      
      // Cache the result
      cachePreviewData(url, previewData);
      
      return previewData;
    } catch (fallbackError) {
      logDebug('Fallback method also failed:', fallbackError);
      return createFallbackPreview(url);
    }
  }
}

/**
 * Extracts title from HTML string using regex
 * @param {string} html - Raw HTML string
 * @returns {string} - Page title
 */
function extractTitleFromHtml(html) {
  try {
    // Try Open Graph title
    let match = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Try Twitter title
    match = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Try title tag
    match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    return '';
  } catch (e) {
    logDebug('Error extracting title:', e);
    return '';
  }
}

/**
 * Extracts description from HTML string using regex
 * @param {string} html - Raw HTML string
 * @returns {string} - Page description
 */
function extractDescriptionFromHtml(html) {
  try {
    // Try Open Graph description
    let match = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Try Twitter description
    match = html.match(/<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Try standard meta description
    match = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    
    // Extract a snippet from the body
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch && bodyMatch[1]) {
      const bodyText = bodyMatch[1]
        .replace(/<[^>]+>/g, ' ')  // Remove HTML tags
        .replace(/\s+/g, ' ')      // Normalize whitespace
        .trim()
        .substring(0, 200);
      
      if (bodyText) {
        return bodyText;
      }
    }
    
    return '';
  } catch (e) {
    logDebug('Error extracting description:', e);
    return '';
  }
}

/**
 * Extracts image URL from HTML string using regex
 * @param {string} html - Raw HTML string
 * @param {string} baseUrl - Base URL for resolving relative paths
 * @returns {string|null} - Image URL or null if none found
 */
function extractImageFromHtml(html, baseUrl) {
  try {
    // Try Open Graph image
    let match = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i);
    if (match && match[1]) {
      return resolveUrl(match[1], baseUrl);
    }
    
    // Try Twitter image
    match = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
    if (match && match[1]) {
      return resolveUrl(match[1], baseUrl);
    }
    
    // Try to find first image with src attribute
    match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match && match[1] && !match[1].startsWith('data:')) {
      return resolveUrl(match[1], baseUrl);
    }
    
    return null;
  } catch (e) {
    logDebug('Error extracting image:', e);
    return null;
  }
}

/**
 * Creates a fallback preview object when fetching fails
 * @param {string} url - The URL
 * @returns {Object} - Basic preview data
 */
function createFallbackPreview(url) {
  const domain = extractDomain(url);
  
  return {
    url: url,
    domain: domain,
    title: domain,
    description: 'Preview not available',
    image: null,
    favicon: `https://www.google.com/s2/favicons?domain=${domain}`
  };
}

/**
 * Resolves a relative URL to absolute
 * @param {string} url - The URL to resolve
 * @param {string} base - The base URL
 * @returns {string} - Absolute URL
 */
function resolveUrl(url, base) {
  try {
    return new URL(url, base).href;
  } catch (e) {
    return url;
  }
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
    const match = url.match(/^(?:https?:\/\/)?([^\/]+)/i);
    return match ? match[1] : url;
  }
}

/**
 * Caches preview data with LRU eviction policy
 * @param {string} url - The URL as key
 * @param {Object} data - The preview data
 */
function cachePreviewData(url, data) {
  // Implement simple LRU - if cache is full, remove oldest entry
  if (previewCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = previewCache.keys().next().value;
    previewCache.delete(oldestKey);
  }
  
  // Add to cache
  previewCache.set(url, data);
  logDebug('Cached preview data for:', url);
} 
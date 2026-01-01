/**
 * LexiPath Content Script
 *
 * Handles:
 * - Page text extraction and processing
 * - Overlay rendering (Shadow DOM)
 * - Word card interactions
 * - Subtitle rendering
 */

import type { Settings, WebEnhanceOutput } from '@lexipath/core';
import { sendMessage } from '../shared/messages';
import { SubtitleController, detectPlatform } from './subtitle-controller';

let subtitleController: SubtitleController | null = null;
let currentSettings: Settings | null = null;
let processedElements = new WeakSet<Element>();
let observer: MutationObserver | null = null;

// Minimum text length to process
const MIN_TEXT_LENGTH = 20;
// Maximum text length per request
const MAX_TEXT_LENGTH = 2000;
// Debounce delay for processing
const PROCESS_DELAY_MS = 300;

/**
 * Get current settings from background.
 */
async function getSettings(): Promise<Settings | null> {
  const response = await sendMessage('GET_SETTINGS', undefined);
  if (response.ok) {
    return response.value;
  }
  console.error('[LexiPath] Failed to get settings:', response.error);
  return null;
}

/**
 * Initialize subtitle controller for video platforms
 */
async function initSubtitleController(): Promise<void> {
  const url = window.location.href;
  const platform = detectPlatform(url);

  if (platform === 'unknown') {
    console.log('[LexiPath] Not a supported video platform');
    return;
  }

  console.log(`[LexiPath] Detected video platform: ${platform}`);

  // Wait for video element to be available
  const maxRetries = 20;
  let retries = 0;

  const checkVideoElement = async (): Promise<void> => {
    const videoElement = document.querySelector('video');

    if (videoElement instanceof HTMLVideoElement) {
      // Video element found, initialize controller
      subtitleController = new SubtitleController();
      const success = await subtitleController.init(url);

      if (success) {
        console.log('[LexiPath] Subtitle controller initialized');
      } else {
        console.warn('[LexiPath] Subtitle controller initialization failed');
      }
    } else if (retries < maxRetries) {
      // Retry after delay
      retries++;
      setTimeout(checkVideoElement, 500);
    } else {
      console.warn('[LexiPath] Video element not found after retries');
    }
  };

  await checkVideoElement();
}

/**
 * Check if an element should be processed for text enhancement
 */
function shouldProcessElement(element: Element): boolean {
  // Skip already processed elements
  if (processedElements.has(element)) return false;

  // Skip non-text elements
  const tagName = element.tagName.toLowerCase();
  const skipTags = ['script', 'style', 'noscript', 'iframe', 'svg', 'canvas', 'video', 'audio', 'input', 'textarea', 'select', 'button', 'code', 'pre'];
  if (skipTags.includes(tagName)) return false;

  // Skip elements with contenteditable
  if (element.getAttribute('contenteditable') === 'true') return false;

  // Skip hidden elements
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  return true;
}

/**
 * Extract text content from element, respecting boundaries
 */
function extractTextContent(element: Element): string {
  const text = element.textContent?.trim() || '';
  return text.slice(0, MAX_TEXT_LENGTH);
}

/**
 * Create enhanced text element with word highlighting
 */
function createEnhancedElement(original: string, enhanced: WebEnhanceOutput): DocumentFragment {
  const fragment = document.createDocumentFragment();

  // If no words to convert, return original text
  if (!enhanced.convert_word || enhanced.convert_word.length === 0) {
    fragment.appendChild(document.createTextNode(original));
    return fragment;
  }

  let currentText = original;

  // Sort words by position in text (process from end to avoid index shifting)
  const words = enhanced.convert_word
    .map(word => ({
      ...word,
      index: currentText.toLowerCase().indexOf(word.original.toLowerCase())
    }))
    .filter(word => word.index !== -1)
    .sort((a, b) => a.index - b.index);

  if (words.length === 0) {
    fragment.appendChild(document.createTextNode(original));
    return fragment;
  }

  let lastIndex = 0;

  for (const word of words) {
    // Add text before the word
    if (word.index > lastIndex) {
      fragment.appendChild(document.createTextNode(currentText.slice(lastIndex, word.index)));
    }

    // Create highlighted word span
    const span = document.createElement('span');
    span.className = 'lexipath-word';
    span.style.cssText = 'border-bottom: 2px dotted #3b82f6; cursor: pointer; position: relative;';
    span.dataset.original = word.original;
    span.dataset.converted = word.converted;
    span.dataset.difficulty = word.difficulty || '';
    span.textContent = word.original;

    // Add tooltip on hover
    span.title = `${word.converted}${word.difficulty ? ` (${word.difficulty})` : ''}`;

    fragment.appendChild(span);

    lastIndex = word.index + word.original.length;
  }

  // Add remaining text
  if (lastIndex < currentText.length) {
    fragment.appendChild(document.createTextNode(currentText.slice(lastIndex)));
  }

  return fragment;
}

/**
 * Process a text node and its parent element
 */
async function processTextElement(element: Element): Promise<void> {
  if (!shouldProcessElement(element)) return;

  const text = extractTextContent(element);
  if (text.length < MIN_TEXT_LENGTH) return;

  // Mark as processed to avoid re-processing
  processedElements.add(element);

  try {
    const response = await sendMessage('ENHANCE_WEB', { content: text });

    if (!response.ok) {
      console.warn('[LexiPath] Enhancement failed:', response.error);
      return;
    }

    const enhanced = response.value;

    // Only modify if there are words to convert
    if (enhanced.convert_word && enhanced.convert_word.length > 0) {
      // Find text nodes and replace them
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];

      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent && node.textContent.trim().length > 0) {
          textNodes.push(node);
        }
      }

      // Process each text node
      for (const textNode of textNodes) {
        const nodeText = textNode.textContent || '';
        const enhancedFragment = createEnhancedElement(nodeText, enhanced);

        // Replace the text node with enhanced content
        const parent = textNode.parentNode;
        if (parent) {
          parent.replaceChild(enhancedFragment, textNode);
        }
      }

      console.log(`[LexiPath] Enhanced ${enhanced.convert_word.length} words`);
    }
  } catch (error) {
    console.error('[LexiPath] Processing error:', error);
  }
}

/**
 * Find and process text elements in the document
 */
function findTextElements(): Element[] {
  // Target paragraph-like elements
  const selectors = [
    'p',
    'article p',
    'main p',
    '.content p',
    '.article-content p',
    'div[class*="content"] p',
    'div[class*="article"] p',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'li',
    'td',
    'blockquote'
  ];

  const elements: Element[] = [];

  for (const selector of selectors) {
    try {
      const found = document.querySelectorAll(selector);
      found.forEach(el => {
        if (shouldProcessElement(el)) {
          elements.push(el);
        }
      });
    } catch {
      // Invalid selector, skip
    }
  }

  return elements;
}

let elementQueue: Element[] = [];
let isProcessing = false;

/**
 * Process elements in queue with rate limiting
 */
async function processElementQueue(): Promise<void> {
  if (isProcessing || elementQueue.length === 0) return;

  isProcessing = true;

  // Process up to 5 elements at a time
  const batch = elementQueue.splice(0, 5);

  await Promise.all(batch.map(el => processTextElement(el)));

  isProcessing = false;

  // Continue processing if there are more elements
  if (elementQueue.length > 0) {
    setTimeout(processElementQueue, PROCESS_DELAY_MS);
  }
}

/**
 * Queue elements for processing
 */
function queueElements(elements: Element[]): void {
  for (const el of elements) {
    if (!processedElements.has(el) && !elementQueue.includes(el)) {
      elementQueue.push(el);
    }
  }
  processElementQueue();
}

/**
 * Set up MutationObserver to handle dynamic content
 */
function setupMutationObserver(): void {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    const newElements: Element[] = [];

    for (const mutation of mutations) {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            // Check the added element itself
            if (shouldProcessElement(node)) {
              newElements.push(node);
            }
            // Check descendants
            const descendants = findTextElements();
            newElements.push(...descendants.filter(el => node.contains(el)));
          }
        });
      }
    }

    if (newElements.length > 0) {
      queueElements(newElements);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

/**
 * Initialize page content processing
 */
async function initPageProcessing(): Promise<void> {
  console.log('[LexiPath] Starting page processing...');

  // Initial processing of existing content
  const elements = findTextElements();
  console.log(`[LexiPath] Found ${elements.length} text elements to process`);

  queueElements(elements);

  // Set up observer for dynamic content
  setupMutationObserver();
}

/**
 * Initialize content script.
 */
async function init(): Promise<void> {
  currentSettings = await getSettings();

  if (!currentSettings?.enabled) {
    console.log('[LexiPath] Extension is disabled');
    return;
  }

  // Check if provider is configured
  if (!currentSettings.provider?.baseUrl || !currentSettings.provider?.model) {
    console.log('[LexiPath] Provider not configured, skipping page processing');
    return;
  }

  console.log('[LexiPath] Content script initialized');

  // Initialize subtitle controller for video platforms
  await initSubtitleController();

  // Initialize page content processing
  await initPageProcessing();
}

/**
 * Cleanup on page unload
 */
function cleanup(): void {
  if (subtitleController) {
    subtitleController.destroy();
    subtitleController = null;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanup);

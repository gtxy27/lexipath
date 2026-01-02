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
import { detectPrimaryLanguage } from '@lexipath/core/qualify';
import { sendMessage } from '../shared/messages';
import { SubtitleController, detectPlatform, type Platform } from './subtitle-controller';

let subtitleController: SubtitleController | null = null;
let currentSettings: Settings | null = null;
let observer: MutationObserver | null = null;

// Minimum text length to process
const MIN_TEXT_LENGTH = 20;
// Maximum text length per request
const MAX_TEXT_LENGTH = 2000;

const MAX_IN_FLIGHT = 3;

type WordRenderMode = 'target-to-native' | 'native-to-target';

let tooltipInjected = false;
let tooltipEl: HTMLDivElement | null = null;
let tooltipTarget: HTMLElement | null = null;

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
async function initSubtitleController(platform: Platform, url: string): Promise<void> {
  console.log(`[LexiPath] Detected video platform: ${platform}`);

  // Wait for video element to be available
  const maxRetries = 20;
  let retries = 0;

  const checkVideoElement = async (): Promise<void> => {
    const videoElement = document.querySelector('video');

    if (videoElement instanceof HTMLVideoElement) {
      // Video element found, initialize controller
      if (!currentSettings) return;
      subtitleController = new SubtitleController(currentSettings);
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

function computeTextSignature(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
    hash |= 0;
  }

  return `${normalized.length}:${hash >>> 0}`;
}

/**
 * Create enhanced text element with word highlighting
 */
function createEnhancedElement(original: string, enhanced: WebEnhanceOutput, mode: WordRenderMode): DocumentFragment {
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
    span.dataset.renderMode = mode;

    const displayText = mode === 'native-to-target' ? word.converted : word.original;
    const tooltipText = mode === 'native-to-target' ? word.original : word.converted;
    span.textContent = displayText;
    span.dataset.tooltip = `${tooltipText}${word.difficulty ? ` (${word.difficulty})` : ''}`;

    // Avoid default browser tooltip delay; we render our own tooltip immediately.
    span.removeAttribute('title');

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

  const signature = computeTextSignature(text);
  if (processedElementSignature.get(element) === signature) return;

  try {
    ensureStylesInjected();
    element.classList.add('lexipath-processing');

    const startMs = performance.now();

    const detected = detectPrimaryLanguage({ text });
    const nativeDetected = currentSettings?.nativeLanguage === 'en' ? 'en' : 'zh';

    const enhancePayload: Record<string, unknown> = { content: text };
    let renderMode: WordRenderMode = 'target-to-native';
    if (currentSettings) {
      // Default mode: target language text -> native language tooltip.
      let sourceLang: string = currentSettings.targetLanguage;
      let targetLang: string = currentSettings.nativeLanguage;

      // If we're learning English and the paragraph is in native Chinese,
      // flip direction so we can still learn from native-language pages.
      if (currentSettings.targetLanguage === 'en' && detected.language === nativeDetected && nativeDetected === 'zh') {
        sourceLang = 'zh';
        targetLang = 'en';
        renderMode = 'native-to-target';
      }

      enhancePayload.sourceLang = sourceLang;
      enhancePayload.targetLang = targetLang;
    }

    const response = await sendMessage('ENHANCE_WEB', enhancePayload);

    if (!response.ok) {
      console.warn('[LexiPath] Enhancement failed:', response.error);
      return;
    }

    const enhanced = response.value;
    processedElementSignature.set(element, signature);

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
        const enhancedFragment = createEnhancedElement(nodeText, enhanced, renderMode);

        // Replace the text node with enhanced content
        const parent = textNode.parentNode;
        if (parent) {
          parent.replaceChild(enhancedFragment, textNode);
        }
      }

      const elapsedMs = Math.round(performance.now() - startMs);
      console.log(`[LexiPath] Enhanced ${enhanced.convert_word.length} words (textNodes=${textNodes.length}, ms=${elapsedMs}, lang=${detected.language})`);
    }
  } catch (error) {
    console.error('[LexiPath] Processing error:', error);
  } finally {
    element.classList.remove('lexipath-processing');
  }
}

function ensureTooltipInjected(): void {
  if (tooltipInjected) return;
  tooltipInjected = true;

  tooltipEl = document.createElement('div');
  tooltipEl.id = 'lexipath-tooltip';
  tooltipEl.style.display = 'none';
  document.documentElement.appendChild(tooltipEl);

  const hide = () => {
    if (!tooltipEl) return;
    tooltipTarget = null;
    tooltipEl.style.display = 'none';
  };

  const position = (clientX: number, clientY: number) => {
    if (!tooltipEl) return;

    const padding = 12;
    const offset = 14;

    tooltipEl.style.left = '0px';
    tooltipEl.style.top = '0px';

    const rect = tooltipEl.getBoundingClientRect();
    let x = clientX + offset;
    let y = clientY + offset;

    const maxX = window.innerWidth - rect.width - padding;
    const maxY = window.innerHeight - rect.height - padding;
    x = Math.max(padding, Math.min(x, maxX));
    y = Math.max(padding, Math.min(y, maxY));

    tooltipEl.style.left = `${Math.round(x)}px`;
    tooltipEl.style.top = `${Math.round(y)}px`;
  };

  const showForWord = (wordEl: HTMLElement, clientX: number, clientY: number) => {
    if (!tooltipEl) return;
    const tooltipText = wordEl.dataset.tooltip?.trim();
    if (!tooltipText) {
      hide();
      return;
    }

    tooltipTarget = wordEl;
    tooltipEl.textContent = tooltipText;
    tooltipEl.style.display = 'block';
    position(clientX, clientY);
  };

  const getWordEl = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const found = target.closest('.lexipath-word');
    return found instanceof HTMLElement ? found : null;
  };

  document.addEventListener('pointerover', (event) => {
    const wordEl = getWordEl(event.target);
    if (!wordEl) return;
    showForWord(wordEl, event.clientX, event.clientY);
  }, true);

  document.addEventListener('pointermove', (event) => {
    if (!tooltipEl || !tooltipTarget) return;
    position(event.clientX, event.clientY);
  }, true);

  document.addEventListener('pointerout', (event) => {
    if (!tooltipTarget) return;
    const next = getWordEl(event.relatedTarget);
    if (next && next === tooltipTarget) return;
    hide();
  }, true);

  document.addEventListener('focusin', (event) => {
    const wordEl = getWordEl(event.target);
    if (!wordEl) return;
    const rect = wordEl.getBoundingClientRect();
    showForWord(wordEl, rect.left, rect.bottom);
  }, true);

  document.addEventListener('focusout', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
}

const processedElementSignature = new WeakMap<Element, string>();
const queuedElements = new WeakSet<Element>();
const inFlightElements = new WeakSet<Element>();

let elementQueue: Element[] = [];
let queueHead = 0;
let inFlightCount = 0;
let pumpScheduled = false;

let stylesInjected = false;

function ensureStylesInjected(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const style = document.createElement('style');
  style.id = 'lexipath-styles';
  style.textContent = `
    .lexipath-word {
      background: rgba(59, 130, 246, 0.18) !important;
      border-bottom: 2px dotted #3b82f6 !important;
      border-radius: 3px !important;
      padding: 0 2px !important;
    }

    .lexipath-processing {
      background: rgba(59, 130, 246, 0.08) !important;
      transition: background 150ms ease-out;
    }

    #lexipath-tooltip {
      position: fixed;
      z-index: 2147483647;
      max-width: min(420px, calc(100vw - 24px));
      padding: 6px 10px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.92);
      color: #ffffff;
      font-size: 13px;
      line-height: 1.35;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
      pointer-events: none;
      white-space: pre-wrap;
      backdrop-filter: blur(6px);
    }
  `;
  document.documentElement.appendChild(style);
  ensureTooltipInjected();
}

function schedulePumpQueue(): void {
  if (pumpScheduled) return;
  pumpScheduled = true;

  const run = () => {
    pumpScheduled = false;
    pumpQueue();
  };

  // Prefer idle time to reduce UI jank, but keep a timeout so it progresses.
  const requestIdleCallback = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number })
    .requestIdleCallback;
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(run, { timeout: 200 });
  } else {
    setTimeout(run, 0);
  }
}

/**
 * Pump queue with concurrency limit; avoids head-of-line blocking from Promise.all batches.
 */
function pumpQueue(): void {
  while (inFlightCount < MAX_IN_FLIGHT && queueHead < elementQueue.length) {
    const el = elementQueue[queueHead++];
    if (!el) continue;

    queuedElements.delete(el);
    if (!shouldProcessElement(el) || inFlightElements.has(el)) continue;

    inFlightElements.add(el);
    inFlightCount++;

    void processTextElement(el)
      .catch(() => {
        // processTextElement already logs; keep queue moving
      })
      .finally(() => {
        inFlightElements.delete(el);
        inFlightCount--;

        // Compact queue occasionally
        if (queueHead > 1000 && queueHead > elementQueue.length / 2) {
          elementQueue = elementQueue.slice(queueHead);
          queueHead = 0;
        }

        schedulePumpQueue();
      });
  }
}

/**
 * Queue elements for processing
 */
function queueElements(elements: Element[]): void {
  for (const el of elements) {
    if (!shouldProcessElement(el)) continue;
    if (queuedElements.has(el) || inFlightElements.has(el)) continue;

    // If element is near viewport, prioritize it for better perceived speed.
    const rect = (el as HTMLElement).getBoundingClientRect?.();
    const isNearViewport = rect
      ? rect.top < window.innerHeight * 1.5 && rect.bottom > -window.innerHeight * 0.5
      : false;

    if (isNearViewport) {
      elementQueue.splice(queueHead, 0, el);
    } else {
      elementQueue.push(el);
    }
    queuedElements.add(el);
  }
  schedulePumpQueue();
}

const TEXT_SELECTOR = [
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
  'blockquote',
].join(', ');

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
            // Check the added element itself + descendants (scoped query, avoids rescanning entire document)
            try {
              if (node.matches(TEXT_SELECTOR) && shouldProcessElement(node)) {
                newElements.push(node);
              }
              const descendants = node.querySelectorAll(TEXT_SELECTOR);
              descendants.forEach((el) => {
                if (shouldProcessElement(el)) newElements.push(el);
              });
            } catch {
              // ignore invalid selector / non-matching roots
            }
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
  const elements = Array.from(document.querySelectorAll(TEXT_SELECTOR)).filter(shouldProcessElement);
  elements.sort((a, b) => {
    const ra = (a as HTMLElement).getBoundingClientRect?.();
    const rb = (b as HTMLElement).getBoundingClientRect?.();
    return (ra?.top ?? 0) - (rb?.top ?? 0);
  });
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

  const url = window.location.href;
  const platform = detectPlatform(url);
  if (platform !== 'unknown') {
    // Video sites: focus on subtitles only (avoid modifying page content).
    await initSubtitleController(platform, url);
    return;
  }

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

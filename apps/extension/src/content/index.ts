/**
 * LexiPath Content Script
 *
 * Handles:
 * - Page text extraction and processing
 * - Overlay rendering (Shadow DOM)
 * - Word card interactions
 * - Subtitle rendering
 */

import type { EnhanceWebPayload, ProviderChannel, Settings, WebEnhanceOutput } from '@lexipath/core';
import { detectPrimaryLanguage, qualifySite } from '@lexipath/core/qualify';
import { sendMessage } from '../shared/messages';
import { SubtitleController, detectPlatform, type Platform } from './subtitle-controller';
import { createEnhancedElement, type WordRenderMode } from './enhanced-text';
import { getI18nMessage } from './i18n';
import { SubtitleOverlay, type WordCardData } from './ui/SubtitleOverlay';

let subtitleController: SubtitleController | null = null;
let currentSettings: Settings | null = null;
let observer: MutationObserver | null = null;
let urlPollTimer: number | null = null;
let navigationToken = 0;
let lastKnownUrl = '';

let webOverlay: SubtitleOverlay | null = null;
let hoverTimer: number | null = null;
const HOVER_UPGRADE_DELAY_MS = 800;
const wordExplainCache = new Map<string, WordCardData>();
const wordExplainInFlight = new Map<string, Promise<WordCardData>>();

function getResolvedTheme(): 'light' | 'dark' {
  if (!currentSettings) return 'dark';
  if (currentSettings.theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return currentSettings.theme === 'dark' ? 'dark' : 'light';
}

function getWebOverlay(): SubtitleOverlay {
  if (!webOverlay) {
    webOverlay = new SubtitleOverlay('youtube', { // platform doesn't matter for web card
      theme: getResolvedTheme(),
      onWordClick: (word, rect) => showFullWordCard(word, rect, true),
    });
    webOverlay.mount();
  } else {
    webOverlay.setTheme(getResolvedTheme());
  }
  return webOverlay;
}

async function getWordCardData(word: string): Promise<WordCardData> {
  const normalized = word.toLowerCase().trim();
  const cached = wordExplainCache.get(normalized);
  if (cached) return cached;

  const inFlight = wordExplainInFlight.get(normalized);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const response = await sendMessage('EXPLAIN_WORD', { word: normalized });
    if (!response.ok) {
      return { word: normalized, definition: getI18nMessage('wordCard_definitionFailed') };
    }
    const data = response.value as any;
    const card: WordCardData = {
      word: data.word || normalized,
      definition: data.definition || getI18nMessage('wordCard_definitionUnavailable'),
      phonetic: data.phonetic,
      difficulty: data.difficulty,
      translation: data.translation,
      example: data.example,
      exampleTranslation: data.example_translation,
    };
    wordExplainCache.set(normalized, card);
    return card;
  })().finally(() => wordExplainInFlight.delete(normalized));

  wordExplainInFlight.set(normalized, promise);
  return promise;
}

async function showFullWordCard(word: string, rect: DOMRect, pinned = false) {
  const overlay = getWebOverlay();
  overlay.showWordCardLoading(word, rect, { pinned });
  const data = await getWordCardData(word);
  overlay.showWordCard(data, rect, { pinned });
}

function isFullCardVisible(): boolean {
  return Boolean(webOverlay && (webOverlay as any).wordCardVisible);
}

// Minimum text length to process
const MIN_TEXT_LENGTH = 20;
// Maximum text length per request
const MAX_TEXT_LENGTH = 2000;

const MAX_IN_FLIGHT = 3;

let tooltipInjected = false;
let tooltipEl: HTMLDivElement | null = null;
let tooltipTarget: HTMLElement | null = null;

type ResolvedRoute = { kind: 1 | 2 | 3; channelId?: number };

function resolveChannel(channelId: number | undefined, settings: Settings): ProviderChannel | null {
  if (typeof channelId !== 'number' || !Number.isFinite(channelId)) return null;
  return settings.channels.find((channel) => channel.channelId === channelId) ?? null;
}

function firstAvailableChannel(settings: Settings): ProviderChannel | null {
  let best: ProviderChannel | null = null;
  for (const channel of settings.channels) {
    if (!best || channel.channelId < best.channelId) best = channel;
  }
  return best;
}

function fallbackToFirstChannel(settings: Settings): ResolvedRoute {
  const first = firstAvailableChannel(settings);
  return { kind: 1, ...(first ? { channelId: first.channelId } : {}) };
}

function resolveRoute(behaviorKey: string, settings: Settings): ResolvedRoute {
  const config = settings.behaviorRoutes?.[behaviorKey];
  if (!config) return fallbackToFirstChannel(settings);
  if (config.kind === 2 || config.kind === 3) return { kind: config.kind };
  const channel = resolveChannel(config.channelId, settings);
  if (channel) return { kind: 1, channelId: channel.channelId };
  return fallbackToFirstChannel(settings);
}

function resolveChannelRoute(behaviorKey: string, settings: Settings): ResolvedRoute {
  const resolved = resolveRoute(behaviorKey, settings);
  if (resolved.kind !== 1) return fallbackToFirstChannel(settings);
  return resolved.channelId ? resolved : fallbackToFirstChannel(settings);
}

function isChannelConfigured(channel: ProviderChannel): boolean {
  if (!channel.model?.trim()) return false;
  const cfg = channel.config as Record<string, unknown>;
  if (channel.typeId === 1) {
    return typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim().length > 0;
  }
  if (channel.typeId === 2 || channel.typeId === 3) {
    return typeof cfg.apiKey === 'string' && cfg.apiKey.trim().length > 0;
  }
  return false;
}

function isKeywordProviderConfigured(settings: Settings): boolean {
  const route = resolveChannelRoute('select_keywords', settings);
  const channel = resolveChannel(route.channelId, settings);
  return Boolean(channel && isChannelConfigured(channel));
}

function isTranslationProviderConfigured(settings: Settings): boolean {
  const route = resolveRoute('translate', settings);
  if (route.kind === 2 || route.kind === 3) return true;
  const channel = resolveChannel(route.channelId, settings);
  return Boolean(channel && isChannelConfigured(channel));
}

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
async function initSubtitleController(platform: Platform, url: string, token: number): Promise<void> {
  if (token !== navigationToken) return;
  console.log(`[LexiPath] Detected video platform: ${platform}`);

  if (subtitleController) {
    subtitleController.destroy();
    subtitleController = null;
  }

  // Wait for video element to be available
  const maxRetries = 20;
  let retries = 0;

  const checkVideoElement = async (): Promise<void> => {
    if (token !== navigationToken) return;
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
 * Process a text node and its parent element
 */
async function processTextElement(element: Element, token: number): Promise<void> {
  if (token !== pageProcessingToken) return;
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

    const enhancePayload: EnhanceWebPayload = { content: text };
    let renderMode: WordRenderMode = 'target-to-native';
    if (currentSettings) {
      // Default mode: target language text -> native language tooltip.
      let sourceLang: EnhanceWebPayload['sourceLang'] = currentSettings.targetLanguage;
      let targetLang: EnhanceWebPayload['targetLang'] = currentSettings.nativeLanguage;

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

    if (token !== pageProcessingToken) return;

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

  const hideTooltip = () => {
    if (!tooltipEl) return;
    tooltipTarget = null;
    tooltipEl.style.display = 'none';
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  };

  const positionTooltip = (clientX: number, clientY: number) => {
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

  const showTooltipForWord = (wordEl: HTMLElement, clientX: number, clientY: number) => {
    if (!tooltipEl || isFullCardVisible()) return;
    const tooltipText = wordEl.dataset.tooltip?.trim();
    if (!tooltipText) {
      hideTooltip();
      return;
    }

    tooltipTarget = wordEl;
    tooltipEl.textContent = tooltipText;
    tooltipEl.style.display = 'block';
    positionTooltip(clientX, clientY);

    // Start timer to upgrade to full card
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      if (tooltipTarget === wordEl) {
        hideTooltip();
        const rect = wordEl.getBoundingClientRect();
        const word = wordEl.dataset.original || wordEl.textContent || '';
        showFullWordCard(word, rect, false);
      }
    }, HOVER_UPGRADE_DELAY_MS);
  };

  const getWordEl = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const found = target.closest('.lexipath-word');
    return found instanceof HTMLElement ? found : null;
  };

  document.addEventListener('pointerover', (event) => {
    const wordEl = getWordEl(event.target);
    if (!wordEl) return;
    showTooltipForWord(wordEl, event.clientX, event.clientY);
  }, true);

  document.addEventListener('pointermove', (event) => {
    if (!tooltipEl || !tooltipTarget) return;
    positionTooltip(event.clientX, event.clientY);
  }, true);

  document.addEventListener('pointerout', (event) => {
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (!tooltipTarget) return;
    const next = getWordEl(event.relatedTarget);
    if (next && next === tooltipTarget) return;
    hideTooltip();
  }, true);

  // Support click to show full card immediately
  document.addEventListener('click', (event) => {
    const wordEl = getWordEl(event.target);
    if (!wordEl) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    hideTooltip();
    const rect = wordEl.getBoundingClientRect();
    const word = wordEl.dataset.original || wordEl.textContent || '';
    showFullWordCard(word, rect, true); // Pinned on click
  }, true);

  document.addEventListener('focusin', (event) => {
    const wordEl = getWordEl(event.target);
    if (!wordEl) return;
    const rect = wordEl.getBoundingClientRect();
    showTooltipForWord(wordEl, rect.left, rect.bottom);
  }, true);

  document.addEventListener('focusout', hideTooltip, true);
  window.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('blur', hideTooltip);
  window.addEventListener('resize', hideTooltip);
}

let processedElementSignature = new WeakMap<Element, string>();
let queuedElements = new WeakSet<Element>();
let inFlightElements = new WeakSet<Element>();

let elementQueue: Element[] = [];
let priorityQueue: Element[] = [];
let pageProcessingToken = 0;
let queueHead = 0;
let inFlightCount = 0;
let pumpScheduled = false;

let stylesInjected = false;
let intersectionObserver: IntersectionObserver | null = null;

function ensureStylesInjected(): void {
  const theme = getResolvedTheme();
  const isDark = theme === 'dark';
  
  const tooltipBg = isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.98)';
  const tooltipText = isDark ? '#ffffff' : '#1e293b';
  const tooltipShadow = isDark ? '0 10px 30px rgba(0, 0, 0, 0.35)' : '0 10px 30px rgba(0, 0, 0, 0.1)';
  const tooltipBorder = isDark ? '1px solid rgba(148, 163, 184, 0.2)' : '1px solid rgba(226, 232, 240, 0.8)';

  let styleEl = document.getElementById('lexipath-styles') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'lexipath-styles';
    document.documentElement.appendChild(styleEl);
  }

  styleEl.textContent = `
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
      background: ${tooltipBg};
      color: ${tooltipText};
      font-size: 13px;
      line-height: 1.35;
      box-shadow: ${tooltipShadow};
      border: ${tooltipBorder};
      pointer-events: none;
      white-space: pre-wrap;
      backdrop-filter: blur(6px);
    }
  `;

  if (!tooltipInjected) {
    ensureTooltipInjected();
  }
}

let priorityQueuedElements = new WeakSet<Element>();

function ensureIntersectionObserver(): void {
  if (intersectionObserver) return;
  if (typeof IntersectionObserver === 'undefined') return;

  intersectionObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target;
        if (!(el instanceof Element)) continue;
        if (!queuedElements.has(el)) continue;
        if (priorityQueuedElements.has(el)) continue;
        priorityQueuedElements.add(el);
        priorityQueue.push(el);
      }

      if (priorityQueue.length > 0) {
        schedulePumpQueue();
      }
    },
    {
      root: null,
      rootMargin: '400px 0px',
      threshold: 0.01,
    }
  );
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
  const token = pageProcessingToken;

  const dequeue = (): Element | null => {
    while (priorityQueue.length > 0) {
      const el = priorityQueue.shift();
      if (!el) continue;
      if (!queuedElements.has(el)) continue;
      return el;
    }

    while (queueHead < elementQueue.length) {
      const el = elementQueue[queueHead++];
      if (!el) continue;
      if (!queuedElements.has(el)) continue;
      return el;
    }

    return null;
  };

  while (inFlightCount < MAX_IN_FLIGHT) {
    const el = dequeue();
    if (!el) break;

    queuedElements.delete(el);
    priorityQueuedElements.delete(el);
    intersectionObserver?.unobserve(el);

    if (!shouldProcessElement(el) || inFlightElements.has(el)) continue;

    inFlightElements.add(el);
    inFlightCount++;

    void processTextElement(el, token)
      .catch(() => {
        // processTextElement already logs; keep queue moving
      })
      .finally(() => {
        if (token !== pageProcessingToken) return;
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
  ensureIntersectionObserver();
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
    intersectionObserver?.observe(el);
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

function resetPageProcessingState(): void {
  pageProcessingToken++;
  pumpScheduled = false;
  inFlightCount = 0;
  elementQueue = [];
  priorityQueue = [];
  queueHead = 0;
  processedElementSignature = new WeakMap<Element, string>();
  queuedElements = new WeakSet<Element>();
  inFlightElements = new WeakSet<Element>();
  priorityQueuedElements = new WeakSet<Element>();

  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (intersectionObserver) {
    intersectionObserver.disconnect();
    intersectionObserver = null;
  }
}

/**
 * Initialize page content processing
 */
async function initPageProcessing(): Promise<void> {
  resetPageProcessingState();
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
async function initForUrl(url: string, token: number): Promise<void> {
  currentSettings = await getSettings();
  if (token !== navigationToken) return;

  if (!currentSettings?.enabled) {
    console.log('[LexiPath] Extension is disabled');
    return;
  }

  const siteDecision = qualifySite({
    url,
    settings: {
      siteMode: currentSettings.siteMode,
      excludedSites: currentSettings.excludedSites,
      allowedSites: currentSettings.allowedSites,
    },
  });
  if (!siteDecision.qualified) {
    console.log(
      `[LexiPath] Site gate blocked processing reason=${siteDecision.reason}${siteDecision.matchedRule ? ` rule=${siteDecision.matchedRule}` : ''}`
    );
    return;
  }

  console.log('[LexiPath] Content script initialized');

  const platform = detectPlatform(url);
  if (platform !== 'unknown') {
    if (!isTranslationProviderConfigured(currentSettings)) {
      console.log(`[LexiPath] ${getI18nMessage('log_providerNotConfiguredSkipPageProcessing')}`);
      return;
    }
    // Video sites: focus on subtitles only (avoid modifying page content).
    await initSubtitleController(platform, url, token);
    return;
  }

  if (!isKeywordProviderConfigured(currentSettings) || !isTranslationProviderConfigured(currentSettings)) {
    console.log(`[LexiPath] ${getI18nMessage('log_providerNotConfiguredSkipPageProcessing')}`);
    return;
  }

  // Initialize page content processing
  await initPageProcessing();
}

function resetAllState(): void {
  if (subtitleController) {
    subtitleController.destroy();
    subtitleController = null;
  }
  resetPageProcessingState();
}

function startUrlWatcher(): void {
  if (urlPollTimer !== null) return;
  urlPollTimer = window.setInterval(() => {
    const url = window.location.href;
    if (url === lastKnownUrl) return;

    lastKnownUrl = url;
    const token = ++navigationToken;
    resetAllState();
    void initForUrl(url, token);
  }, 1000);
}

async function init(): Promise<void> {
  lastKnownUrl = window.location.href;
  const token = ++navigationToken;
  resetAllState();
  await initForUrl(lastKnownUrl, token);
  startUrlWatcher();
}

/**
 * Cleanup on page unload
 */
function cleanup(): void {
  if (urlPollTimer !== null) {
    window.clearInterval(urlPollTimer);
    urlPollTimer = null;
  }
  resetAllState();
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanup);

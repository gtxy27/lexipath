/**
 * LexiPath Content Script
 *
 * Handles:
 * - Page text extraction and processing
 * - Overlay rendering (Shadow DOM)
 * - Word card interactions
 * - Subtitle rendering
 */

import browser from "webextension-polyfill";
import type {
  EnhanceWebPayload,
  ProviderChannel,
  Settings,
  WebEnhanceOutput,
  WordFamiliarity,
} from "@lexipath/core";
import { detectPrimaryLanguage, qualifySite } from "@lexipath/core/qualify";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { sendMessage } from "../shared/messages";
import {
  SubtitleController,
  detectPlatform,
  type Platform,
} from "./subtitle-controller";
import {
  createEnhancedElement,
  createEnhancedRenderer,
  type WordRenderMode,
} from "./enhanced-text";
import { getI18nMessage } from "./i18n";
import { SubtitleOverlay, type WordCardData } from "./ui/SubtitleOverlay";
import { EnglishCorrectionController } from "./english-correction";
import { FloatingButtonController } from "../ui/components/ui/floating-button-controller";

const log = createLogger("content");

let subtitleController: SubtitleController | null = null;
let englishCorrectionController: EnglishCorrectionController | null = null;
let floatingButtonController: FloatingButtonController | null = null;
let currentSettings: Settings | null = null;
let currentSiteQualified = false;
let observer: MutationObserver | null = null;
let urlPollTimer: number | null = null;
let navigationToken = 0;
let lastKnownUrl = "";

let webOverlay: SubtitleOverlay | null = null;
let hoverTimer: number | null = null;
const HOVER_UPGRADE_DELAY_MS = 800;
const wordExplainCache = new Map<string, WordCardData>();
const wordExplainInFlight = new Map<string, Promise<WordCardData>>();
let selectionExplainInjected = false;
const HAS_ENHANCED_ONCE_KEY = "lexipath-has-enhanced-once";

const SHOW_ORIGINAL_CLASS = "lexipath-show-original";
const TAB_SHOW_ORIGINAL_KEY = "lexipath-tab-show-original";
const ENHANCE_PAUSED_CLASS = "lexipath-enhance-paused";
const TAB_ENHANCE_PAUSED_KEY = "lexipath-tab-enhance-paused";
const FLOATING_HIDE_ONCE_KEY = "lexipath-floating-hide-once";

const FORGOTTEN_MIN_ENCOUNTERS = 2;
const FORGOTTEN_MAX_FAMILIARITY = 30;

type WordFamiliarityLite = { familiarity: number; encounters: number };
const wordFamiliarityCache = new Map<string, WordFamiliarityLite>();
const pageForgottenWords = new Map<string, { word: string; familiarity: number; encounters: number }>();
const exposureSentWords = new Set<string>();
const pageTranslatedWords = new Set<string>();
let pagePrimaryLanguage: string | null = null;
let pageEligibleForLearning = true;
let enhancePauseObserver: MutationObserver | null = null;

let exposureObserver: IntersectionObserver | null = null;
const exposureTargets = new WeakMap<Element, string[]>();
const exposureTimers = new Map<Element, number>();

function getTabShowOriginalOverride(): boolean | null {
  try {
    const raw = sessionStorage.getItem(TAB_SHOW_ORIGINAL_KEY);
    if (raw === null) return null;
    return raw === "1";
  } catch (error: unknown) {
    void error;
    return null;
  }
}

function getEffectiveWebShowOriginal(settings: Settings | null): boolean {
  if (!settings) return false;
  const tabOverride = getTabShowOriginalOverride();
  return tabOverride ?? Boolean(settings.webShowOriginal);
}

function applyWebShowOriginal(settings: Settings | null): void {
  const enabled = getEffectiveWebShowOriginal(settings);
  document.documentElement.classList.toggle(SHOW_ORIGINAL_CLASS, enabled);
}

function toggleTabShowOriginal(): void {
  if (!currentSettings) return;
  const next = !getEffectiveWebShowOriginal(currentSettings);
  try {
    sessionStorage.setItem(TAB_SHOW_ORIGINAL_KEY, next ? "1" : "0");
  } catch (error: unknown) {
    void error;
  }
  applyWebShowOriginal(currentSettings);
}

function isEnhancePausedNow(): boolean {
  return document.documentElement.classList.contains(ENHANCE_PAUSED_CLASS);
}

function applyTabEnhancePausedFromStorage(): void {
  let paused = false;
  try {
    paused = sessionStorage.getItem(TAB_ENHANCE_PAUSED_KEY) === "1";
  } catch (error: unknown) {
    void error;
  }
  document.documentElement.classList.toggle(ENHANCE_PAUSED_CLASS, paused);
}

function forceHideTooltipAndCard(): void {
  tooltipTarget = null;
  if (tooltipEl) tooltipEl.style.display = "none";
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  try {
    webOverlay?.hideWordCard?.();
  } catch (error: unknown) {
    void error;
  }
}

function clearPendingPageProcessingQueues(): void {
  // Stop further processing quickly (in-flight requests cannot be aborted, but we can stop pumping/queuing).
  pumpScheduled = false;
  elementQueue = [];
  priorityQueue = [];
  queueHead = 0;
}

function ensureEnhancePauseObserver(): void {
  if (enhancePauseObserver) return;
  enhancePauseObserver = new MutationObserver(() => {
    if (isEnhancePausedNow()) {
      clearPendingPageProcessingQueues();
      forceHideTooltipAndCard();
      return;
    }

    // Resuming: if we still have backlog, keep pumping.
    if (getQueuedBacklogCount() > 0) {
      schedulePumpQueue({ eager: true });
    }
  });

  enhancePauseObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

function getResolvedTheme(): "light" | "dark" {
  if (!currentSettings) return "dark";
  if (currentSettings.theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return currentSettings.theme === "dark" ? "dark" : "light";
}

function resolveWordCardTtsLang(settings: Settings | null): string {
  if (!settings) return "en-US";
  const targetLanguage = settings.targetLanguage;

  if (targetLanguage === "en") {
    return settings.wordCardEnglishAccent === "uk" ? "en-GB" : "en-US";
  }
  if (targetLanguage === "ja") return "ja-JP";
  if (targetLanguage === "ko") return "ko-KR";
  if (targetLanguage === "fr") return "fr-FR";
  if (targetLanguage === "de") return "de-DE";
  if (targetLanguage === "zh") {
    return settings.nativeLanguage === "zh-TW" ? "zh-TW" : "zh-CN";
  }

  return "en-US";
}

function getWebOverlay(): SubtitleOverlay {
  if (!webOverlay) {
    webOverlay = new SubtitleOverlay("youtube", {
      // platform doesn't matter for web card
      theme: getResolvedTheme(),
      onWordClick: (word, rect) => showFullWordCard(word, rect, true),
    });
    webOverlay.setWordCardConfig({
      sectionsOrder:
        currentSettings?.wordCardSectionsOrder ?? [
          "definition",
          "translation",
          "example",
          "exampleTranslation",
        ],
      autoPronounce: currentSettings?.wordCardAutoPronounce ?? true,
      ttsLang: resolveWordCardTtsLang(currentSettings),
    });
    webOverlay.mount();
  } else {
    webOverlay.setTheme(getResolvedTheme());
    webOverlay.setWordCardConfig({
      sectionsOrder:
        currentSettings?.wordCardSectionsOrder ?? [
          "definition",
          "translation",
          "example",
          "exampleTranslation",
        ],
      autoPronounce: currentSettings?.wordCardAutoPronounce ?? true,
      ttsLang: resolveWordCardTtsLang(currentSettings),
    });
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
    const response = await sendMessage("EXPLAIN_WORD", { word: normalized });
    if (!response.ok) {
      return {
        word: normalized,
        definition: getI18nMessage("wordCard_definitionFailed"),
      };
    }
    const data = response.value as any;
    const card: WordCardData = {
      word: data.word || normalized,
      definition:
        data.definition || getI18nMessage("wordCard_definitionUnavailable"),
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

function ensureSelectionExplainInjected(): void {
  if (selectionExplainInjected) return;
  selectionExplainInjected = true;

  const isInsideLexipathUi = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false;
    if (target.closest("#lexipath-subtitle-overlay")) return true;
    if (target.closest("#lexipath-floating-button-container")) return true;
    if (target.closest("#lexipath-tooltip")) return true;
    return false;
  };

  const normalizeSelectedWord = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return "";

    try {
      // Trim punctuation from both ends.
      const cleaned = trimmed.replace(/^[^\p{L}\p{M}']+|[^\p{L}\p{M}']+$/gu, "");
      if (!cleaned) return "";
      if (cleaned.length > 60) return "";
      if (/\s/u.test(cleaned)) return "";
      if (!/^[\p{L}\p{M}'’-]+$/u.test(cleaned)) return "";
      return cleaned;
    } catch (error: unknown) {
      // Fallback for engines without Unicode property escapes.
      void error;
      const cleaned = trimmed.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "");
      if (!cleaned) return "";
      if (cleaned.length > 60) return "";
      if (/\s/.test(cleaned)) return "";
      if (!/^[A-Za-z0-9'’-]+$/.test(cleaned)) return "";
      return cleaned;
    }
  };

  const getSelectionAnchorRect = (fallbackEvent: MouseEvent): DOMRect => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return new DOMRect(fallbackEvent.clientX, fallbackEvent.clientY, 1, 1);
    }
    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect && (rect.width > 0 || rect.height > 0)) return rect;
    } catch (error: unknown) {
      void error;
    }
    return new DOMRect(fallbackEvent.clientX, fallbackEvent.clientY, 1, 1);
  };

  let lastOpenAt = 0;
  const tryOpenFromSelection = (event: MouseEvent) => {
    if (!currentSettings?.enabled) return;
    if ((currentSettings.webSelectionExplainEnabled ?? true) === false) return;
    if (isInsideLexipathUi(event.target)) return;

    const now = Date.now();
    if (now - lastOpenAt < 250) return;

    const selection = window.getSelection();
    const selectedText = selection?.toString?.() ?? "";
    const word = normalizeSelectedWord(selectedText);
    if (!word) return;

    lastOpenAt = now;
    const rect = getSelectionAnchorRect(event);
    showFullWordCard(word, rect, true);
  };

  document.addEventListener("dblclick", tryOpenFromSelection, true);
  // Some sites block dblclick; mouseup.detail==2 is a reliable fallback.
  document.addEventListener(
    "mouseup",
    (event) => {
      if (event.detail !== 2) return;
      tryOpenFromSelection(event);
    },
    true,
  );
}

function normalizeWordKey(raw: string): string {
  return raw.trim().toLowerCase();
}

async function getFamiliarityForWords(
  words: string[],
): Promise<Record<string, WordFamiliarityLite>> {
  const normalized = Array.from(new Set(words.map(normalizeWordKey).filter(Boolean)));
  if (normalized.length === 0) return {};

  const missing = normalized.filter((w) => !wordFamiliarityCache.has(w));
  if (missing.length > 0) {
    const response = await sendMessage("BATCH_GET_WORD_FAMILIARITY", { words: missing });
    if (response.ok) {
      const seen = new Set<string>();
      for (const record of response.value as WordFamiliarity[]) {
        const key = normalizeWordKey(record.word);
        if (!key) continue;
        seen.add(key);
        wordFamiliarityCache.set(key, {
          familiarity: record.familiarity ?? 0,
          encounters: record.encounters ?? 0,
        });
      }
      for (const key of missing) {
        if (seen.has(normalizeWordKey(key))) continue;
        wordFamiliarityCache.set(key, { familiarity: 0, encounters: 0 });
      }
    } else {
      for (const key of missing) {
        wordFamiliarityCache.set(key, { familiarity: 0, encounters: 0 });
      }
    }
  }

  const out: Record<string, WordFamiliarityLite> = {};
  for (const key of normalized) {
    out[key] = wordFamiliarityCache.get(key) ?? { familiarity: 0, encounters: 0 };
  }
  return out;
}

function updateForgottenWordsForPage(
  surfaceWords: string[],
  familiarityByWord: Record<string, WordFamiliarityLite>,
): void {
  let changed = false;
  for (const surface of surfaceWords) {
    const key = normalizeWordKey(surface);
    if (!key) continue;
    const record = familiarityByWord[key];
    if (!record) continue;

    const isForgotten =
      record.encounters >= FORGOTTEN_MIN_ENCOUNTERS &&
      record.familiarity < FORGOTTEN_MAX_FAMILIARITY;
    if (!isForgotten) continue;

    if (!pageForgottenWords.has(key)) {
      pageForgottenWords.set(key, {
        word: surface,
        familiarity: record.familiarity,
        encounters: record.encounters,
      });
      changed = true;
    }
  }

  if (changed) {
    const list = Array.from(pageForgottenWords.values()).sort(
      (a, b) => a.familiarity - b.familiarity || b.encounters - a.encounters || a.word.localeCompare(b.word),
    );
    floatingButtonController?.updatePageContext?.({ forgottenWords: list });
  }
}

// Minimum text length to process
const MIN_TEXT_LENGTH = 20;
// Maximum text length per request
const MAX_TEXT_LENGTH = 2000;

// plan15 [NOW][FE] DONE (performance): viewport-prioritized queue + IntersectionObserver + idle scheduling + concurrency cap.
function getMaxInFlight(): number {
  // Match user's expectation: content-side in-flight should follow the effective channel concurrency (bounded),
  // so we can saturate the provider while still avoiding catastrophic DOM jank.
  const settings = currentSettings;

  const resolveWebEnhanceChannelLimit = (): number => {
    if (!settings) return 15;

    // Background ENHANCE_WEB uses translate channel when translate is LLM; otherwise it uses select_keywords channel.
    const translateRoute = resolveRoute("translate", settings);
    const keywordRoute = resolveChannelRoute("select_keywords", settings);
    const route = translateRoute.kind === 1 ? translateRoute : keywordRoute;
    const channel =
      route.kind === 1 ? resolveChannel(route.channelId, settings) : null;
    const raw = channel?.concurrencyLimit;
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 1) {
      return Math.min(500, Math.floor(raw));
    }
    return 15;
  };

  const channelLimit = resolveWebEnhanceChannelLimit();
  let base = Math.min(20, Math.max(4, channelLimit));

  if (window.matchMedia("(pointer: coarse)").matches) {
    return Math.min(base, 4);
  }

  // Weak CPUs: cap a bit lower, but still allow visible concurrency.
  const hw = typeof navigator.hardwareConcurrency === "number"
    ? navigator.hardwareConcurrency
    : 0;
  if (hw > 0 && hw <= 4) {
    base = Math.min(base, 10);
  }

  return base;
}

let tooltipInjected = false;
let tooltipEl: HTMLDivElement | null = null;
let tooltipTarget: HTMLElement | null = null;

type ResolvedRoute = { kind: 1 | 2 | 3; channelId?: number };

function resolveChannel(
  channelId: number | undefined,
  settings: Settings,
): ProviderChannel | null {
  if (typeof channelId !== "number" || !Number.isFinite(channelId)) return null;
  return (
    settings.channels.find((channel) => channel.channelId === channelId) ?? null
  );
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

function resolveChannelRoute(
  behaviorKey: string,
  settings: Settings,
): ResolvedRoute {
  const resolved = resolveRoute(behaviorKey, settings);
  if (resolved.kind !== 1) return fallbackToFirstChannel(settings);
  return resolved.channelId ? resolved : fallbackToFirstChannel(settings);
}

function isChannelConfigured(channel: ProviderChannel): boolean {
  if (!channel.model?.trim()) return false;
  const cfg = channel.config as Record<string, unknown>;
  if (channel.typeId === 1) {
    return typeof cfg.baseUrl === "string" && cfg.baseUrl.trim().length > 0;
  }
  if (channel.typeId === 2 || channel.typeId === 3) {
    return typeof cfg.apiKey === "string" && cfg.apiKey.trim().length > 0;
  }
  return false;
}

function isKeywordProviderConfigured(settings: Settings): boolean {
  const route = resolveChannelRoute("select_keywords", settings);
  const channel = resolveChannel(route.channelId, settings);
  return Boolean(channel && isChannelConfigured(channel));
}

function isTranslationProviderConfigured(settings: Settings): boolean {
  const route = resolveRoute("translate", settings);
  if (route.kind === 2 || route.kind === 3) return true;
  const channel = resolveChannel(route.channelId, settings);
  return Boolean(channel && isChannelConfigured(channel));
}

/**
 * Get current settings from background.
 */
async function getSettings(): Promise<Settings | null> {
  const response = await sendMessage("GET_SETTINGS", undefined);
  if (response.ok) {
    return response.value;
  }
  log.error("Failed to get settings", response.error);
  return null;
}

/**
 * Initialize subtitle controller for video platforms
 */
async function initSubtitleController(
  platform: Platform,
  url: string,
  token: number,
): Promise<void> {
  if (token !== navigationToken) return;
  log.info(`Detected video platform: ${platform}`);

  if (subtitleController) {
    subtitleController.destroy();
    subtitleController = null;
  }

  // Wait for video element to be available
  const maxRetries = 20;
  let retries = 0;

  const checkVideoElement = async (): Promise<void> => {
    if (token !== navigationToken) return;
    const videoElement = document.querySelector("video");

    if (videoElement instanceof HTMLVideoElement) {
      // Video element found, initialize controller
      if (!currentSettings) return;
      subtitleController = new SubtitleController(currentSettings);
      const success = await subtitleController.init(url);

      if (success) {
        log.info("Subtitle controller initialized");
      } else {
        log.warn("Subtitle controller initialization failed");
      }
    } else if (retries < maxRetries) {
      // Retry after delay
      retries++;
      setTimeout(checkVideoElement, 500);
    } else {
      log.warn("Video element not found after retries");
    }
  };

  await checkVideoElement();
}

/**
 * Check if an element should be processed for text enhancement
 */
function shouldProcessElement(element: Element): boolean {
  if (!shouldQueueElement(element)) return false;

  // Skip hidden elements (expensive; avoid calling this on large scans).
  if (element.hasAttribute("hidden")) return false;

  // Skip non-text elements
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;

  return true;
}

function shouldQueueElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  const skipTags = [
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "video",
    "audio",
    "input",
    "textarea",
    "select",
    "button",
    "code",
    "pre",
  ];
  if (skipTags.includes(tagName)) return false;

  // Skip elements with contenteditable
  if (element.getAttribute("contenteditable") === "true") return false;

  return true;
}

/**
 * Extract text content from element, respecting boundaries
 */
function extractTextContent(element: Element): string {
  const stored = (element as HTMLElement | null)?.dataset?.lxOriginalText;
  const text = (typeof stored === "string" && stored.trim()
    ? stored.trim()
    : element.textContent?.trim()) || "";
  return text.slice(0, MAX_TEXT_LENGTH);
}

function computeTextSignature(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) + hash + normalized.charCodeAt(i);
    hash |= 0;
  }

  return `${normalized.length}:${hash >>> 0}`;
}

/**
 * Process a text node and its parent element
 */
async function processTextElement(
  element: Element,
  token: number,
): Promise<void> {
  if (token !== pageProcessingToken) return;
  if (isEnhancePausedNow()) return;
  if (!pageEligibleForLearning && manualForceEnhanceMode !== "full") return;
  if (!shouldProcessElement(element)) return;

  const text = extractTextContent(element);
  if (text.length < MIN_TEXT_LENGTH) return;

  // Keep a stable baseline for signature/toggle-original. (Limited by MAX_TEXT_LENGTH)
  try {
    (element as HTMLElement).dataset.lxOriginalText = text;
  } catch (error: unknown) {
    void error;
  }

  const signature = computeTextSignature(text);
  if (processedElementSignature.get(element) === signature) return;

  try {
    ensureStylesInjected();
    element.classList.add("lexipath-processing");

    const isDarkMode = getResolvedTheme() === "dark";
    const startMs = performance.now();

    const detected = detectPrimaryLanguage({ text });
    const nativeDetected =
      currentSettings?.nativeLanguage === "en" ? "en" : "zh";

    const scenes = currentSettings?.scenesEnabled;
    if (scenes) {
      if (detected.language === nativeDetected && scenes.webNative === false) {
        return;
      }
      if (
        currentSettings?.targetLanguage &&
        detected.language === currentSettings.targetLanguage &&
        scenes.webTarget === false
      ) {
        return;
      }
    }

    const enhancePayload: EnhanceWebPayload = { content: text };

    let renderMode: WordRenderMode = "target-to-native";
    let sourceLang: EnhanceWebPayload["sourceLang"] = currentSettings?.targetLanguage;
    let targetLang: EnhanceWebPayload["targetLang"] = currentSettings?.nativeLanguage;

    if (currentSettings) {
      // Default mode: target language text -> native language tooltip.
      sourceLang = currentSettings.targetLanguage;
      targetLang = currentSettings.nativeLanguage;

      // If we're learning English and the paragraph is in native Chinese,
      // flip direction so we can still learn from native-language pages.
      if (
        currentSettings.targetLanguage === "en" &&
        detected.language === nativeDetected &&
        nativeDetected === "zh"
      ) {
        sourceLang = "zh";
        targetLang = "en";
        renderMode = "native-to-target";
      }
    }

    const forcedEnhanceMode =
      manualForceEnhanceMode && manualForceEnhanceModeToken === token
        ? manualForceEnhanceMode
        : null;
    const requestedEnhanceMode =
      forcedEnhanceMode ??
      (renderMode === "native-to-target"
        ? (currentSettings?.webEnhanceModeNative ?? "i_plus_1")
        : (currentSettings?.webEnhanceMode ?? "i_plus_1"));
    const safeElementForFullReplace = element.childElementCount === 0;
    const effectiveEnhanceMode =
      requestedEnhanceMode === "full" && !safeElementForFullReplace
        ? "i_plus_1"
        : requestedEnhanceMode;
    // plan15 [NOW][FE] DONE (safety): Full paragraph replacement only runs on leaf elements; otherwise fall back to i+1.

    if (effectiveEnhanceMode === "full") {
      renderMode = "target-to-native";

      // Full rewrite: when learning English, allow rewriting non-English content into English.
      // The background expects `targetLang: "en"` to enable the rewrite path.
      if (
        currentSettings?.targetLanguage === "en" &&
        detected.language &&
        detected.language !== "en" &&
        detected.language !== "unknown"
      ) {
        sourceLang = detected.language as any;
        targetLang = "en";
      }
    }

    enhancePayload.mode = effectiveEnhanceMode;
    enhancePayload.sourceLang = sourceLang;
    enhancePayload.targetLang = targetLang;

    const response = await sendMessage("ENHANCE_WEB", enhancePayload);

    if (!response.ok) {
      log.warn("Enhancement failed", response.error);
      return;
    }

    if (token !== pageProcessingToken) return;
    if (isEnhancePausedNow()) return;

    const enhanced = response.value;
    const surfaceWords = enhanced.convert_word?.map((w) => w.original) ?? [];
    const familiarityByWord = await getFamiliarityForWords(surfaceWords);
    updateForgottenWordsForPage(surfaceWords, familiarityByWord);

    const normalizedSurfaceWords = Array.from(
      new Set(surfaceWords.map(normalizeWordKey).filter(Boolean)),
    );
    registerExposure(element, normalizedSurfaceWords);

    const prevTranslatedCount = pageTranslatedWords.size;
    for (const key of normalizedSurfaceWords) pageTranslatedWords.add(key);
    if (pageTranslatedWords.size !== prevTranslatedCount) {
      floatingButtonController?.updatePageContext?.({ translatedCount: pageTranslatedWords.size });
    }

    const styleMapping =
      currentSettings?.webStyleMapping ?? ({
        within: "dashedLine",
        out: "border",
        forgotten: "weakened",
      } as const);

    if (
      effectiveEnhanceMode === "full" &&
      safeElementForFullReplace &&
      typeof enhanced.content_result === "string" &&
      enhanced.content_result.trim() &&
      enhanced.content_result !== text &&
      enhanced.convert_word &&
      enhanced.convert_word.length > 0
    ) {
      element.textContent = "";

      const originalSpan = document.createElement("span");
      originalSpan.className = "lexipath-paragraph-original";
      originalSpan.textContent = text;

      const enhancedSpan = document.createElement("span");
      enhancedSpan.className = "lexipath-paragraph-enhanced";
      enhancedSpan.appendChild(
        createEnhancedElement(
          enhanced.content_result,
          enhanced,
          "target-to-native",
          {
            webEnhanceMode: effectiveEnhanceMode,
            ...(currentSettings ? { userLevel: currentSettings.proficiencyLevel } : {}),
            styleMapping,
            familiarityByWord,
            isDarkMode,
          },
        ),
      );

      element.appendChild(originalSpan);
      element.appendChild(enhancedSpan);

      const elapsedMs = Math.round(performance.now() - startMs);
      log.debug(
        `Enhanced full paragraph (words=${enhanced.convert_word.length}, ms=${elapsedMs}, lang=${detected.language})`,
      );
      processedElementSignature.set(element, computeTextSignature(extractTextContent(element)));
      return;
    }

    // Only modify if there are words to convert
    if (enhanced.convert_word && enhanced.convert_word.length > 0) {
      const renderEnhanced = createEnhancedRenderer(enhanced, renderMode, {
        webEnhanceMode: effectiveEnhanceMode,
        ...(currentSettings ? { userLevel: currentSettings.proficiencyLevel } : {}),
        styleMapping,
        familiarityByWord,
        isDarkMode,
      });

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
        const nodeText = textNode.textContent || "";
        const enhancedFragment = renderEnhanced(nodeText);

        // Replace the text node with enhanced content
        const parent = textNode.parentNode;
        if (parent) {
          parent.replaceChild(enhancedFragment, textNode);
        }
      }

      const elapsedMs = Math.round(performance.now() - startMs);
      log.debug(
        `Enhanced ${enhanced.convert_word.length} words (textNodes=${textNodes.length}, ms=${elapsedMs}, lang=${detected.language})`,
      );
    }

    processedElementSignature.set(element, computeTextSignature(extractTextContent(element)));
  } catch (error) {
    log.error("Processing error", { message: getErrorMessage(error) });
  } finally {
    element.classList.remove("lexipath-processing");
  }
}

function ensureTooltipInjected(): void {
  if (tooltipInjected) return;
  tooltipInjected = true;

  tooltipEl = document.createElement("div");
  tooltipEl.id = "lexipath-tooltip";
  tooltipEl.style.display = "none";
  document.documentElement.appendChild(tooltipEl);

  const hideTooltip = () => {
    if (!tooltipEl) return;
    tooltipTarget = null;
    tooltipEl.style.display = "none";
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  };

  const positionTooltip = (clientX: number, clientY: number) => {
    if (!tooltipEl) return;

    const padding = 12;
    const offset = 14;

    tooltipEl.style.left = "0px";
    tooltipEl.style.top = "0px";

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

  const showTooltipForWord = (
    wordEl: HTMLElement,
    clientX: number,
    clientY: number,
  ) => {
    if (isEnhancePausedNow()) return;
    // plan15: mobile/touch relies on click-to-open bottom sheet; do not show hover tooltip.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (!tooltipEl || isFullCardVisible()) return;
    const tooltipText = wordEl.dataset.tooltip?.trim();
    if (!tooltipText) {
      hideTooltip();
      return;
    }

    tooltipTarget = wordEl;
    tooltipEl.textContent = tooltipText;
    tooltipEl.style.display = "block";
    positionTooltip(clientX, clientY);

    // Start timer to upgrade to full card
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      if (tooltipTarget === wordEl) {
        hideTooltip();
        const rect = wordEl.getBoundingClientRect();
        const word = wordEl.dataset.lookup || wordEl.dataset.original || wordEl.textContent || "";
        showFullWordCard(word, rect, false);
      }
    }, HOVER_UPGRADE_DELAY_MS);
  };

  const getWordEl = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const found = target.closest(".lexipath-word");
    return found instanceof HTMLElement ? found : null;
  };

  document.addEventListener(
    "pointerover",
    (event) => {
      if (isEnhancePausedNow()) return;
      const wordEl = getWordEl(event.target);
      if (!wordEl) return;
      showTooltipForWord(wordEl, event.clientX, event.clientY);
    },
    true,
  );

  document.addEventListener(
    "pointermove",
    (event) => {
      if (!tooltipEl || !tooltipTarget) return;
      positionTooltip(event.clientX, event.clientY);
    },
    true,
  );

  document.addEventListener(
    "pointerout",
    (event) => {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (!tooltipTarget) return;
      const next = getWordEl(event.relatedTarget);
      if (next && next === tooltipTarget) return;
      hideTooltip();
    },
    true,
  );

  // Support click to show full card immediately
  document.addEventListener(
    "click",
    (event) => {
      if (isEnhancePausedNow()) return;
      const wordEl = getWordEl(event.target);
      if (!wordEl) return;

      event.preventDefault();
      event.stopPropagation();

      hideTooltip();
      const rect = wordEl.getBoundingClientRect();
      const word = wordEl.dataset.lookup || wordEl.dataset.original || wordEl.textContent || "";
      showFullWordCard(word, rect, true); // Pinned on click
    },
    true,
  );

  document.addEventListener(
    "focusin",
    (event) => {
      if (isEnhancePausedNow()) return;
      const wordEl = getWordEl(event.target);
      if (!wordEl) return;
      const rect = wordEl.getBoundingClientRect();
      showTooltipForWord(wordEl, rect.left, rect.bottom);
    },
    true,
  );

  document.addEventListener("focusout", hideTooltip, true);
  window.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("blur", hideTooltip);
  window.addEventListener("resize", hideTooltip);
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
let injectedStylesKey: string | null = null;
let intersectionObserver: IntersectionObserver | null = null;

function ensureStylesInjected(): void {
  const theme = getResolvedTheme();
  const isDark = theme === "dark";
  const customCss = currentSettings?.webCustomCss?.trim() ?? "";
  const nextStylesKey = `${theme}::${customCss}`;

  const tooltipBg = isDark
    ? "rgba(15, 23, 42, 0.92)"
    : "rgba(255, 255, 255, 0.98)";
  const tooltipText = isDark ? "#ffffff" : "#1e293b";
  const tooltipShadow = isDark
    ? "0 10px 30px rgba(0, 0, 0, 0.35)"
    : "0 10px 30px rgba(0, 0, 0, 0.1)";
  const tooltipBorder = isDark
    ? "1px solid rgba(148, 163, 184, 0.2)"
    : "1px solid rgba(226, 232, 240, 0.8)";

  let styleEl = document.getElementById("lexipath-styles") as HTMLStyleElement | null;
  if (stylesInjected && injectedStylesKey === nextStylesKey && styleEl) {
    if (!tooltipInjected) ensureTooltipInjected();
    return;
  }

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "lexipath-styles";
    document.documentElement.appendChild(styleEl);
  }

  styleEl.textContent = `
	     .lexipath-word {
	       cursor: pointer;
	       position: relative;
	       border-radius: 3px;
	       padding: 0 2px;
	       border-bottom: 2px dotted var(--lx-word-color, #3b82f6);
	       background: rgba(59, 130, 246, 0.12);
	     }

	     /* Avoid changing table layout (padding/background can expand rows/cells). */
	     table .lexipath-word,
	     td .lexipath-word,
	     th .lexipath-word {
	       padding: 0 !important;
	       background: transparent !important;
	       border-bottom: none !important;
	       border-radius: 0 !important;
	       cursor: inherit !important;
	     }

     @media (pointer: coarse) {
       .lexipath-word {
         border-bottom-width: 3px;
         padding: 2px 0;
       }
     }

     /* plan15: style key system (data-lx-style="<key>") */
     [data-lx-style="border"] {
       border-bottom-style: dotted;
     }
     [data-lx-style="dashedLine"] {
       border-bottom-style: dashed;
       background: rgba(99, 102, 241, 0.10);
     }
     [data-lx-style="weakened"] {
       opacity: 0.85;
       background: rgba(244, 63, 94, 0.10);
     }
     [data-lx-style="background"] {
       background: rgba(34, 197, 94, 0.10);
     }
     [data-lx-style="textColor"] {
       color: ${isDark ? "#e2e8f0" : "#0f172a"};
       background: rgba(148, 163, 184, 0.12);
     }

     /* plan15: original/enhanced toggle */
     .lexipath-word__original {
       display: none;
     }
     .${SHOW_ORIGINAL_CLASS} .lexipath-word__original {
       display: inline;
     }
     .${SHOW_ORIGINAL_CLASS} .lexipath-word__enhanced {
       display: none;
     }

     .lexipath-paragraph-original {
       display: none;
     }
     .${SHOW_ORIGINAL_CLASS} .lexipath-paragraph-original {
       display: inline;
     }
     .${SHOW_ORIGINAL_CLASS} .lexipath-paragraph-enhanced {
       display: none;
     }

     /* plan15: cancel enhancement (pause) should look like the original page. */
     .${ENHANCE_PAUSED_CLASS} .lexipath-word {
       cursor: text;
       padding: 0 !important;
       background: transparent !important;
       border-bottom: none !important;
       border-radius: 0 !important;
     }
     .${ENHANCE_PAUSED_CLASS} .lexipath-word__original {
       display: inline;
     }
     .${ENHANCE_PAUSED_CLASS} .lexipath-word__enhanced {
       display: none;
     }
     .${ENHANCE_PAUSED_CLASS} .lexipath-paragraph-original {
       display: inline;
     }
     .${ENHANCE_PAUSED_CLASS} .lexipath-paragraph-enhanced {
       display: none;
     }

	    .lexipath-processing {
	      background: rgba(59, 130, 246, 0.08) !important;
	      transition: background 150ms ease-out;
	    }

	    table .lexipath-processing,
	    td.lexipath-processing,
	    th.lexipath-processing {
	      background: transparent !important;
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

     ${customCss}
   `;

  stylesInjected = true;
  injectedStylesKey = nextStylesKey;

  if (!tooltipInjected) {
    ensureTooltipInjected();
  }
}

let priorityQueuedElements = new WeakSet<Element>();

function ensureIntersectionObserver(): void {
  if (intersectionObserver) return;
  if (typeof IntersectionObserver === "undefined") return;

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
      rootMargin: "400px 0px",
      threshold: 0.01,
    },
  );
}

function ensureExposureObserver(): void {
  if (exposureObserver) return;
  if (typeof IntersectionObserver === "undefined") return;

  exposureObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const el = entry.target;
        if (!(el instanceof Element)) continue;

        const existingTimer = exposureTimers.get(el);
        if (!entry.isIntersecting) {
          if (existingTimer) {
            clearTimeout(existingTimer);
            exposureTimers.delete(el);
          }
          continue;
        }

        if (existingTimer) continue;

        const timer = window.setTimeout(() => {
          exposureTimers.delete(el);
          const words = exposureTargets.get(el) ?? [];
          const toSend = words.filter((w) => !exposureSentWords.has(w));
          if (toSend.length === 0) return;

          for (const w of toSend) exposureSentWords.add(w);
          floatingButtonController?.updatePageContext?.({ seenCount: exposureSentWords.size });
          void sendMessage("RECORD_EXPOSURE_VALID", { words: toSend });
        }, 2000);
        exposureTimers.set(el, timer);
      }
    },
    { root: null, rootMargin: "0px", threshold: 0.35 },
  );
}

function registerExposure(element: Element, normalizedWords: string[]): void {
  if (normalizedWords.length === 0) return;
  ensureExposureObserver();
  exposureTargets.set(element, normalizedWords);
  exposureObserver?.observe(element);
}

const PUMP_IDLE_TIMEOUT_MS = 50;

function getQueuedBacklogCount(): number {
  return priorityQueue.length + Math.max(0, elementQueue.length - queueHead);
}

function shouldPumpEagerly(): boolean {
  const pending = getQueuedBacklogCount();
  if (pending <= 0) return false;

  const maxInFlight = getMaxInFlight();
  if (inFlightCount < maxInFlight) return true;

  // Large backlog: keep pumping without waiting for idle.
  return pending > maxInFlight * 2;
}

function schedulePumpQueue(opts?: { eager?: boolean }): void {
  if (isEnhancePausedNow()) return;
  if (pumpScheduled) return;
  pumpScheduled = true;

  const run = () => {
    pumpScheduled = false;
    pumpQueue();
  };

  const eager = opts?.eager ?? shouldPumpEagerly();
  if (eager) {
    if (typeof queueMicrotask === "function") {
      queueMicrotask(run);
    } else {
      Promise.resolve().then(run);
    }
    return;
  }

  // Prefer idle time to reduce UI jank, but keep a short timeout so it progresses.
  const requestIdleCallback = (
    window as unknown as {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout?: number },
      ) => number;
    }
  ).requestIdleCallback;
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(run, { timeout: PUMP_IDLE_TIMEOUT_MS });
  } else {
    setTimeout(run, 0);
  }
}

/**
 * Pump queue with concurrency limit; avoids head-of-line blocking from Promise.all batches.
 */
function pumpQueue(): void {
  if (isEnhancePausedNow()) return;
  const token = pageProcessingToken;
  const maxInFlight = getMaxInFlight();

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

  while (inFlightCount < maxInFlight) {
    const el = dequeue();
    if (!el) break;

    queuedElements.delete(el);
    priorityQueuedElements.delete(el);
    intersectionObserver?.unobserve(el);

    if (!shouldProcessElement(el) || inFlightElements.has(el)) continue;

    inFlightElements.add(el);
    inFlightCount++;

    void processTextElement(el, token)
      .catch((error: unknown) => {
        log.debug("processTextElement failed; keeping queue moving", { message: getErrorMessage(error) });
      })
      .finally(() => {
        if (token !== pageProcessingToken) return;
        inFlightElements.delete(el);
        inFlightCount--;

        if (
          manualForceEnhanceMode &&
          manualForceEnhanceModeToken === token &&
          inFlightCount <= 0 &&
          getQueuedBacklogCount() === 0
        ) {
          manualForceEnhanceMode = null;
          manualForceEnhanceModeToken = 0;
        }

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
function queueElements(
  elements: Element[],
  opts?: { rectPrioritization?: boolean },
): void {
  ensureIntersectionObserver();
  const rectPrioritization = opts?.rectPrioritization ?? false;
  for (const el of elements) {
    if (!shouldQueueElement(el)) continue;
    if (queuedElements.has(el) || inFlightElements.has(el)) continue;

    if (rectPrioritization) {
      // If element is near viewport, prioritize it for better perceived speed.
      // Avoid doing this on huge scans to prevent layout thrash.
      const rect = (el as HTMLElement).getBoundingClientRect?.();
      const isNearViewport = rect
        ? rect.top < window.innerHeight * 1.5 &&
          rect.bottom > -window.innerHeight * 0.5
        : false;

      if (isNearViewport) {
        if (!priorityQueuedElements.has(el)) {
          priorityQueuedElements.add(el);
          priorityQueue.push(el);
        } else {
          elementQueue.push(el);
        }
      } else {
        elementQueue.push(el);
      }
    } else {
      elementQueue.push(el);
    }
    queuedElements.add(el);
    intersectionObserver?.observe(el);
  }
  schedulePumpQueue({ eager: true });
}

const TEXT_SELECTOR = [
  "p",
  "article p",
  "main p",
  ".content p",
  ".article-content p",
  'div[class*="content"] p',
  'div[class*="article"] p',
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "td",
  "blockquote",
].join(", ");

function evaluatePageEligibility(settings: Settings | null): void {
  pagePrimaryLanguage = null;
  pageEligibleForLearning = true;

  if (!settings) return;
  if (detectPlatform(window.location.href) !== "unknown") return;

  try {
    const els = document.querySelectorAll(TEXT_SELECTOR);
    let sample = "";
    const maxEls = Math.min(25, els.length);
    for (let i = 0; i < maxEls; i++) {
      const el = els[i];
      if (!el) continue;
      const text = extractTextContent(el);
      if (!text) continue;
      sample += ` ${text.slice(0, 220)}`;
      if (sample.length >= 2200) break;
    }

    if (sample.trim().length < 120) return;

    const detected = detectPrimaryLanguage({ text: sample });
    const language = typeof detected?.language === "string" ? detected.language : "unknown";
    pagePrimaryLanguage = language;

    const nativeBase = settings.nativeLanguage?.split?.("-")?.[0] ?? settings.nativeLanguage;
    const target = settings.targetLanguage;

    if (!target || language === "unknown") {
      pageEligibleForLearning = true;
      return;
    }

    pageEligibleForLearning = language === target || language === nativeBase;
  } catch (error: unknown) {
    void error;
    pagePrimaryLanguage = null;
    pageEligibleForLearning = true;
  }
}

function resolvePageWebEnhanceMode(settings: Settings | null): "i_plus_1" | "light" | "full" {
  if (!settings) return "i_plus_1";

  // Match the direction logic used in `processTextElement` (best-effort at page-level).
  const nativeDetected = settings.nativeLanguage === "en" ? "en" : "zh";
  if (
    settings.targetLanguage === "en" &&
    pagePrimaryLanguage === nativeDetected &&
    nativeDetected === "zh"
  ) {
    return (settings.webEnhanceModeNative ?? "i_plus_1") as any;
  }
  return (settings.webEnhanceMode ?? "i_plus_1") as any;
}

function syncFloatingButtonMeta(): void {
  floatingButtonController?.updatePageContext?.({
    pageEligible: pageEligibleForLearning,
    ...(pagePrimaryLanguage ? { pageLanguage: pagePrimaryLanguage } : {}),
    webEnhanceMode: resolvePageWebEnhanceMode(currentSettings),
    translatedCount: pageTranslatedWords.size,
    seenCount: exposureSentWords.size,
  });
}

/**
 * Set up MutationObserver to handle dynamic content
 */
function setupMutationObserver(): void {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    const newElements: Element[] = [];

    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            // Check the added element itself + descendants (scoped query, avoids rescanning entire document)
            try {
              if (node.matches(TEXT_SELECTOR) && shouldQueueElement(node)) {
                newElements.push(node);
              }
              const descendants = node.querySelectorAll(TEXT_SELECTOR);
              descendants.forEach((el) => {
                if (shouldQueueElement(el)) newElements.push(el);
              });
            } catch (error: unknown) {
              log.debug("MutationObserver selector check failed; ignoring node", { message: getErrorMessage(error) });
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
    subtree: true,
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

  if (exposureObserver) {
    exposureObserver.disconnect();
    exposureObserver = null;
  }
  for (const timer of exposureTimers.values()) {
    clearTimeout(timer);
  }
  exposureTimers.clear();

  exposureSentWords.clear();
  pageTranslatedWords.clear();
  pageForgottenWords.clear();
  floatingButtonController?.updatePageContext?.({ forgottenWords: [], translatedCount: 0, seenCount: 0 });
}

/**
 * Initialize page content processing
 */
async function initPageProcessing(options?: { forceMode?: EnhanceWebPayload["mode"] }): Promise<void> {
  resetPageProcessingState();
  manualForceEnhanceMode = options?.forceMode ?? null;
  manualForceEnhanceModeToken = manualForceEnhanceMode ? pageProcessingToken : 0;
  log.info("Starting page processing");

  // Initial processing of existing content
  // Avoid expensive operations (computedStyle + getBoundingClientRect sort) on large pages,
  // otherwise we delay the first visible results and it feels "non-concurrent".
  const selectorResults = document.querySelectorAll(TEXT_SELECTOR);
  log.info(`Found ${selectorResults.length} candidate text elements`);

  const scanToken = pageProcessingToken;
  const total = selectorResults.length;
  const CHUNK_SIZE = 500;
  let idx = 0;

  const scanChunk = () => {
    if (scanToken !== pageProcessingToken) return;

    const chunk: Element[] = [];
    const end = Math.min(total, idx + CHUNK_SIZE);
    for (; idx < end; idx++) {
      const el = selectorResults[idx];
      if (!el) continue;
      if (!shouldQueueElement(el)) continue;
      chunk.push(el);
    }

    if (chunk.length > 0) {
      queueElements(chunk, { rectPrioritization: idx <= CHUNK_SIZE });
    }

    if (idx < total) {
      setTimeout(scanChunk, 0);
    } else {
      log.info(`Queued ${total} candidate elements for processing`);
    }
  };

  scanChunk();

  // Set up observer for dynamic content
  setupMutationObserver();
}

let manualEnhanceInFlight = false;
let manualForceEnhanceMode: EnhanceWebPayload["mode"] | null = null;
let manualForceEnhanceModeToken = 0;

async function runManualPageProcessingOnce(options?: { forceMode?: EnhanceWebPayload["mode"] }): Promise<void> {
  if (manualEnhanceInFlight) return;
  manualEnhanceInFlight = true;
  try {
    resetPageProcessingState();
    manualForceEnhanceMode = options?.forceMode ?? null;
    manualForceEnhanceModeToken = manualForceEnhanceMode ? pageProcessingToken : 0;
    log.info("Starting manual page processing");

    const selectorResults = document.querySelectorAll(TEXT_SELECTOR);
    log.info(`Found ${selectorResults.length} candidate text elements to process (manual)`);

    const scanToken = pageProcessingToken;
    const total = selectorResults.length;
    const CHUNK_SIZE = 500;
    let idx = 0;

    const scanChunk = () => {
      if (scanToken !== pageProcessingToken) return;

      const chunk: Element[] = [];
      const end = Math.min(total, idx + CHUNK_SIZE);
      for (; idx < end; idx++) {
        const el = selectorResults[idx];
        if (!el) continue;
        if (!shouldQueueElement(el)) continue;
        chunk.push(el);
      }

      if (chunk.length > 0) {
        queueElements(chunk, { rectPrioritization: idx <= CHUNK_SIZE });
      }

      if (idx < total) {
        setTimeout(scanChunk, 0);
      } else {
        log.info(`Queued ${total} candidate elements for processing (manual)`);
      }
    };

    scanChunk();
  } finally {
    manualEnhanceInFlight = false;
  }
}

async function requestWebEnhanceOnce(): Promise<void> {
  if (!currentSettings?.enabled) {
    log.info("Manual enhance requested, but extension is disabled");
    return;
  }

  try {
    sessionStorage.setItem(HAS_ENHANCED_ONCE_KEY, "1");
  } catch (error: unknown) {
    void error;
  }

  const url = window.location.href;
  const platform = detectPlatform(url);
  if (platform !== "unknown") {
    log.info("Manual enhance requested on video platform; ignoring");
    return;
  }

  if (!currentSettings) return;
  if (
    !isKeywordProviderConfigured(currentSettings) ||
    !isTranslationProviderConfigured(currentSettings)
  ) {
    log.warn(getI18nMessage("log_providerNotConfiguredSkipPageProcessing"));
    return;
  }

  evaluatePageEligibility(currentSettings);
  syncFloatingButtonMeta();
  if (!pageEligibleForLearning) {
    log.info(`Manual enhance skipped: page language not eligible lang=${pagePrimaryLanguage ?? "unknown"}`);
    return;
  }

  if (currentSettings.autoEnhance) {
    await initPageProcessing();
    return;
  }

  await runManualPageProcessingOnce();
}

async function requestWebRewriteOnce(): Promise<void> {
  if (!currentSettings?.enabled) {
    log.info("Rewrite requested, but extension is disabled");
    return;
  }

  try {
    sessionStorage.setItem(HAS_ENHANCED_ONCE_KEY, "1");
  } catch (error: unknown) {
    void error;
  }

  const url = window.location.href;
  const platform = detectPlatform(url);
  if (platform !== "unknown") {
    log.info("Rewrite requested on video platform; ignoring");
    return;
  }

  if (!currentSettings) return;
  if (
    !isKeywordProviderConfigured(currentSettings) ||
    !isTranslationProviderConfigured(currentSettings)
  ) {
    log.warn(getI18nMessage("log_providerNotConfiguredSkipPageProcessing"));
    return;
  }

  // We are explicitly rewriting into the learning language; treat the page as eligible for this run.
  pageEligibleForLearning = true;
  pagePrimaryLanguage = currentSettings.targetLanguage ?? pagePrimaryLanguage;
  syncFloatingButtonMeta();

  // Force full rewrite for this run (best-effort; background will fall back if unsupported).
  if (currentSettings.autoEnhance) {
    await initPageProcessing({ forceMode: "full" });
    return;
  }

  await runManualPageProcessingOnce({ forceMode: "full" });
}

/**
 * Initialize content script.
 */
async function initForUrl(url: string, token: number): Promise<void> {
  currentSettings = await getSettings();
  if (token !== navigationToken) return;
  currentSiteQualified = false;

  if (!currentSettings?.enabled) {
    log.info("Extension is disabled");
    englishCorrectionController?.setSettings(null);
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
    log.info(
      `Site gate blocked processing reason=${siteDecision.reason}${siteDecision.matchedRule ? ` rule=${siteDecision.matchedRule}` : ""}`,
    );
    englishCorrectionController?.setSettings(null);
    return;
  }
  currentSiteQualified = true;

  evaluatePageEligibility(currentSettings);
  syncFloatingButtonMeta();

  log.info("Content script initialized");

  if (!englishCorrectionController) {
    englishCorrectionController = new EnglishCorrectionController();
    englishCorrectionController.start();
  }
  englishCorrectionController.setSettings(currentSettings);

  const platform = detectPlatform(url);
  if (platform !== "unknown") {
    if (!currentSettings.autoEnhance) {
      log.info("Auto enhancement disabled; skipping subtitle processing");
      return;
    }
    const scenes = currentSettings.scenesEnabled;
    if (scenes && scenes.videoNative === false && scenes.videoTarget === false) {
      log.info("Video scenes disabled; skipping subtitle processing");
      return;
    }
    if (!isTranslationProviderConfigured(currentSettings)) {
      log.warn(getI18nMessage("log_providerNotConfiguredSkipPageProcessing"));
      return;
    }
    // Video sites: focus on subtitles only (avoid modifying page content).
    await initSubtitleController(platform, url, token);
    return;
  }

  if (
    !isKeywordProviderConfigured(currentSettings) ||
    !isTranslationProviderConfigured(currentSettings)
  ) {
    log.warn(getI18nMessage("log_providerNotConfiguredSkipPageProcessing"));
    return;
  }

  if (!currentSettings.autoEnhance) {
    log.info("Auto enhancement disabled; skipping page processing");
    return;
  }

  const scenes = currentSettings.scenesEnabled;
  if (scenes && scenes.webNative === false && scenes.webTarget === false) {
    log.info("Web scenes disabled; skipping page processing");
    return;
  }

  if (!pageEligibleForLearning) {
    log.info(`Page language not eligible; skipping page processing lang=${pagePrimaryLanguage ?? "unknown"}`);
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

  applyWebShowOriginal(currentSettings);
  applyTabEnhancePausedFromStorage();
  ensureSelectionExplainInjected();
  ensureEnhancePauseObserver();

  if (!floatingButtonController) {
    floatingButtonController = new FloatingButtonController(currentSettings, {
      onRunWebEnhanceOnce: requestWebEnhanceOnce,
      onRunWebRewriteOnce: requestWebRewriteOnce,
    });
    floatingButtonController.mount();
  }
  syncFloatingButtonMeta();

  browser.storage?.onChanged?.addListener?.((changes: any, area: string) => {
    if (area !== "local") return;
    const nextSettings = changes?.settings?.newValue;
    if (!nextSettings) return;
    const prevTheme = currentSettings?.theme;
    const prevFloating = currentSettings?.floatingButtonEnabled ?? true;
    currentSettings = nextSettings;

	    englishCorrectionController?.setSettings(nextSettings);
	    floatingButtonController?.updateSettings(nextSettings);
	    applyWebShowOriginal(nextSettings);
	    evaluatePageEligibility(nextSettings);
	    subtitleController?.setSettings(nextSettings);
	    syncFloatingButtonMeta();

    const nextFloating = nextSettings?.floatingButtonEnabled ?? true;
    if (!prevFloating && nextFloating) {
      try {
        sessionStorage.removeItem(FLOATING_HIDE_ONCE_KEY);
      } catch (error: unknown) {
        void error;
      }
    }

	    if (prevTheme !== nextSettings?.theme) {
	      const resolvedTheme = getResolvedTheme();
	      if (webOverlay) webOverlay.setTheme(resolvedTheme);
	      ensureStylesInjected();
	    }

	    if (webOverlay) {
	      webOverlay.setWordCardConfig({
	        sectionsOrder: nextSettings.wordCardSectionsOrder,
	        autoPronounce: nextSettings.wordCardAutoPronounce,
	        ttsLang: resolveWordCardTtsLang(nextSettings),
	      });
	    }
	  });

  browser.runtime?.onMessage?.addListener?.((message: any) => {
    if (message?.type === "LEXIPATH_TOGGLE_ORIGINAL_TAB") {
      toggleTabShowOriginal();
      return;
    }
  });
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
  englishCorrectionController?.destroy();
  englishCorrectionController = null;
}

// Initialize when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

// Cleanup on page unload
window.addEventListener("beforeunload", cleanup);

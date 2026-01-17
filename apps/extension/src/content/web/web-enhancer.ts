import { SupportedLanguageSchema, type EnhanceWebPayload, type Settings, type WebEnhanceOutput } from "@lexipath/core";
import { detectPrimaryLanguage } from "@lexipath/core/qualify";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { sendMessage } from "../../shared/messages";
import { createExposureTracker } from "./web-enhancer-exposure";
import { createFamiliarityTracker } from "./web-enhancer-familiarity";
import {
  computeTextSignature,
  extractTextContent,
  getResolvedTheme,
  normalizeWordKey,
} from "./web-enhancer-utils";
import { getI18nMessage } from "../i18n";
import { isEnhancePausedNow } from "../../shared/tab-state";
import { HAS_ENHANCED_ONCE_KEY } from "../ui/floating-button-constants";
import { detectPlatform } from "../platform";
import type { WordRenderMode } from "../enhanced-text";
import type { WebWordCardManager } from "./web-word-card";
import { injectFullParagraph, injectInlineWords } from "./dom-injector";
import { getWebSiteAdapter } from "./site-adapters";
import { ensureWebStylesInjected } from "./web-styles";
import { createWebTooltipManager, type WebTooltipManager } from "./web-tooltip";

type WebProcessingStatus = {
  keywordProviderConfigured: boolean;
  translationProviderConfigured: boolean;
  webEnhanceConcurrencyLimit: number;
};

type WordFamiliarityLite = { familiarity: number; encounters: number };

type PageContextUpdate = Partial<{
  forgottenWords: Array<{ word: string; familiarity: number; encounters: number }>;
  translatedCount: number;
  seenCount: number;
  webEnhanceMode: "i_plus_1" | "light" | "full";
  pageEligible: boolean;
  pageLanguage: string;
}>;

export type WebEnhancer = Readonly<{
  setSettings: (settings: Settings | null) => void;
  destroy: () => void;
  resetPageState: () => void;
  initForUrl: (url: string) => Promise<void>;
  requestEnhanceOnce: () => Promise<void>;
  requestRewriteOnce: () => Promise<void>;
  ensureEnhancePauseObserver: () => void;
}>;

const log = createLogger("web-enhancer");

const FORGOTTEN_MIN_ENCOUNTERS = 2;
const FORGOTTEN_MAX_FAMILIARITY = 30;

const MIN_TEXT_LENGTH = 20;
const MAX_TEXT_LENGTH = 2000;

const PUMP_IDLE_TIMEOUT_MS = 50;



export function createWebEnhancer(options: {
  getSettings: () => Settings | null;
  getWordCardManager: () => WebWordCardManager;
  onPageContextUpdate?: (update: PageContextUpdate) => void;
}): WebEnhancer {
  let currentUrl = window.location.href;
  let currentSettings: Settings | null = options.getSettings();
  let webProcessingStatus: WebProcessingStatus | null = null;

  let pagePrimaryLanguage: string | null = null;
  let pageEligibleForLearning = true;

  const exposureSentWords = new Set<string>();
  const pageTranslatedWords = new Set<string>();


  const familiarityTracker = createFamiliarityTracker({
    normalizeWordKey,
    sendMessage: (type, payload) => sendMessage(type, payload),
    emitContext: (update) => emitContext(update),
    thresholds: {
      minEncounters: FORGOTTEN_MIN_ENCOUNTERS,
      maxFamiliarity: FORGOTTEN_MAX_FAMILIARITY,
    },
  });

  let observer: MutationObserver | null = null;
  let enhancePauseObserver: MutationObserver | null = null;


  let pageProcessingToken = 0;
  let processedElementSignature = new WeakMap<Element, string>();
  let queuedElements = new WeakSet<Element>();
  let inFlightElements = new WeakSet<Element>();
  let priorityQueuedElements = new WeakSet<Element>();

  let elementQueue: Element[] = [];
  let priorityQueue: Element[] = [];
  let queueHead = 0;
  let inFlightCount = 0;
  let pumpScheduled = false;

  let intersectionObserver: IntersectionObserver | null = null;
  let manualEnhanceInFlight = false;
  let manualForceEnhanceMode: EnhanceWebPayload["mode"] | null = null;
  let manualForceEnhanceModeToken = 0;

  const tooltipManager: WebTooltipManager = createWebTooltipManager({
    getWordCardManager: options.getWordCardManager,
  });

  const emitContext = (update: PageContextUpdate) => {
    options.onPageContextUpdate?.(update);
  };

  const resolvePageWebEnhanceMode = (
    settings: Settings | null,
  ): "i_plus_1" | "light" | "full" => {
    if (!settings) return "i_plus_1";

    const nativeDetected = settings.nativeLanguage === "en" ? "en" : "zh";
    if (
      settings.targetLanguage === "en" &&
      pagePrimaryLanguage === nativeDetected &&
      nativeDetected === "zh"
    ) {
      return settings.webEnhanceModeNative ?? "i_plus_1";
    }
    return settings.webEnhanceMode ?? "i_plus_1";
  };

  const syncFloatingMeta = () => {
    emitContext({
      pageEligible: pageEligibleForLearning,
      ...(pagePrimaryLanguage ? { pageLanguage: pagePrimaryLanguage } : {}),
      webEnhanceMode: resolvePageWebEnhanceMode(currentSettings),
      translatedCount: pageTranslatedWords.size,
      seenCount: exposureSentWords.size,
    });
  };

  const refreshWebProcessingStatus = async (): Promise<void> => {
    const response = await sendMessage("GET_WEB_PROCESSING_STATUS", undefined);
    if (response.ok) {
      webProcessingStatus = response.value;
      return;
    }
    log.error("Failed to get web processing status", response.error);
    webProcessingStatus = null;
  };

  const ensureWebProcessingStatus = async (): Promise<WebProcessingStatus | null> => {
    if (webProcessingStatus) return webProcessingStatus;
    await refreshWebProcessingStatus();
    return webProcessingStatus;
  };

  const getMaxInFlight = (): number => {
    const channelLimit = webProcessingStatus?.webEnhanceConcurrencyLimit ?? 15;
    let base = Math.min(20, Math.max(4, channelLimit));

    if (window.matchMedia("(pointer: coarse)").matches) {
      return Math.min(base, 4);
    }

    const hw =
      typeof navigator.hardwareConcurrency === "number"
        ? navigator.hardwareConcurrency
        : 0;
    if (hw > 0 && hw <= 4) {
      base = Math.min(base, 10);
    }

    return base;
  };

  const getQueuedBacklogCount = (): number => {
    return priorityQueue.length + Math.max(0, elementQueue.length - queueHead);
  };

  const shouldPumpEagerly = (): boolean => {
    const pending = getQueuedBacklogCount();
    if (pending <= 0) return false;

    const maxInFlight = getMaxInFlight();
    if (inFlightCount < maxInFlight) return true;

    return pending > maxInFlight * 2;
  };

  const schedulePumpQueue = (opts?: { eager?: boolean }) => {
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

    type RequestIdleCallback = (callback: () => void, options?: { timeout: number }) => number;
    const requestIdleCallback = (window as Window & { requestIdleCallback?: RequestIdleCallback }).requestIdleCallback;
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: PUMP_IDLE_TIMEOUT_MS });
      return;
    }
    setTimeout(run, PUMP_IDLE_TIMEOUT_MS);
  };

  const ensureIntersectionObserver = () => {
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
      { root: null, rootMargin: "400px 0px", threshold: 0.01 },
    );
  };

  const exposureTracker = createExposureTracker({
    sendMessage,
    emitContext: (update) => emitContext(update),
    exposureSentWords,
  });


  const queueElements = (
    elements: Element[],
    opts?: { rectPrioritization?: boolean },
  ) => {
    ensureIntersectionObserver();
    for (const el of elements) {
      if (!el) continue;
      if (queuedElements.has(el)) continue;
      if (opts?.rectPrioritization) {
        priorityQueuedElements.add(el);
        priorityQueue.push(el);
      } else {
        elementQueue.push(el);
      }
      queuedElements.add(el);
      intersectionObserver?.observe(el);
    }
    schedulePumpQueue({ eager: true });
  };

  const setupMutationObserver = () => {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      const adapter = getWebSiteAdapter(currentUrl);
      const newElements: Element[] = [];

      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          try {
            if (
              node.matches(adapter.textSelector) &&
              adapter.shouldQueueElement(node)
            ) {
              newElements.push(node);
            }
            const descendants = node.querySelectorAll(adapter.textSelector);
            descendants.forEach((el) => {
              if (adapter.shouldQueueElement(el)) newElements.push(el);
            });
          } catch (error: unknown) {
            log.debug("MutationObserver selector check failed; ignoring node", {
              message: getErrorMessage(error),
            });
          }
        });
      }

      if (newElements.length > 0) {
        queueElements(newElements);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  };

  const resetPageProcessingState = () => {
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

    exposureTracker.disconnect();

    pageTranslatedWords.clear();
    familiarityTracker.resetPageTracking();
    emitContext({ forgottenWords: [], translatedCount: 0, seenCount: 0 });
  };

  const clearPendingPageProcessingQueues = () => {
    pumpScheduled = false;
    elementQueue = [];
    priorityQueue = [];
    queueHead = 0;
  };

  const evaluatePageEligibility = (settings: Settings | null) => {
    pagePrimaryLanguage = null;
    pageEligibleForLearning = true;

    if (!settings) return;
    if (detectPlatform(window.location.href) !== "unknown") return;

    try {
      const adapter = getWebSiteAdapter(currentUrl);
      const els = document.querySelectorAll(adapter.textSelector);
      let sample = "";
      const maxEls = Math.min(25, els.length);
      for (let i = 0; i < maxEls; i++) {
        const el = els[i];
        if (!el) continue;
        const text = extractTextContent(el, MAX_TEXT_LENGTH);
        if (!text) continue;
        sample += ` ${text.slice(0, 220)}`;
        if (sample.length >= 2200) break;
      }

      if (sample.trim().length < 120) return;

      const detected = detectPrimaryLanguage({ text: sample });
      const language =
        typeof detected?.language === "string" ? detected.language : "unknown";
      pagePrimaryLanguage = language;

      const nativeBase =
        settings.nativeLanguage?.split?.("-")?.[0] ?? settings.nativeLanguage;
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
  };



  const processTextElement = async (element: Element, token: number) => {
    if (token !== pageProcessingToken) return;
    if (isEnhancePausedNow()) return;
    if (!pageEligibleForLearning && manualForceEnhanceMode !== "full") return;

    const adapter = getWebSiteAdapter(currentUrl);
    if (!adapter.shouldProcessElement(element)) return;

    const text = extractTextContent(element, MAX_TEXT_LENGTH);
    if (text.length < MIN_TEXT_LENGTH) return;

    try {
      (element as HTMLElement).dataset.lxOriginalText = text;
    } catch (error: unknown) {
      void error;
    }

    const signature = computeTextSignature(text);
    if (processedElementSignature.get(element) === signature) return;

    try {
      const theme = getResolvedTheme(currentSettings);
      const isDarkMode = theme === "dark";
      ensureWebStylesInjected({ settings: currentSettings, theme });
      tooltipManager.ensureMounted();
      element.classList.add("lexipath-processing");

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
      let sourceLang: EnhanceWebPayload["sourceLang"] =
        currentSettings?.targetLanguage;
      let targetLang: EnhanceWebPayload["targetLang"] =
        currentSettings?.nativeLanguage;

      if (currentSettings) {
        sourceLang = currentSettings.targetLanguage;
        targetLang = currentSettings.nativeLanguage;

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

      if (effectiveEnhanceMode === "full") {
        renderMode = "target-to-native";

        if (
          currentSettings?.targetLanguage === "en" &&
          detected.language &&
          detected.language !== "en" &&
          detected.language !== "unknown"
        ) {
          const parsed = SupportedLanguageSchema.safeParse(detected.language);
          if (parsed.success) {
            sourceLang = parsed.data;
            targetLang = "en";
          }
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

      const enhanced = response.value satisfies WebEnhanceOutput;

      const surfaceWords = (enhanced.convert_word ?? [])
        .map((w) => w.original.trim())
        .filter(Boolean);
      const normalizedSurfaceWords = Array.from(
        new Set(surfaceWords.map(normalizeWordKey).filter(Boolean)),
      );

      const familiarityByWord = await familiarityTracker.getFamiliarityForWords(normalizedSurfaceWords);
      familiarityTracker.updateForgottenWordsForPage(surfaceWords, familiarityByWord);
      exposureTracker.registerExposure(element, normalizedSurfaceWords);

      const prevTranslatedCount = pageTranslatedWords.size;
      for (const key of normalizedSurfaceWords) pageTranslatedWords.add(key);
      if (pageTranslatedWords.size !== prevTranslatedCount) {
        emitContext({ translatedCount: pageTranslatedWords.size });
      }

      const styleMapping =
        currentSettings?.webStyleMapping ??
        ({
          within: "dashedLine",
          out: "border",
          forgotten: "weakened",
        } as const);

      const enhancedTextOptions = {
        webEnhanceMode: effectiveEnhanceMode,
        ...(currentSettings
          ? { userLevel: currentSettings.proficiencyLevel }
          : {}),
        styleMapping,
        familiarityByWord,
        isDarkMode,
      };

      if (
        effectiveEnhanceMode === "full" &&
        safeElementForFullReplace &&
        typeof enhanced.content_result === "string" &&
        enhanced.content_result.trim() &&
        enhanced.content_result !== text &&
        enhanced.convert_word &&
        enhanced.convert_word.length > 0
      ) {
        injectFullParagraph({
          element,
          originalText: text,
          enhancedText: enhanced.content_result,
          enhanced,
          enhancedTextOptions,
        });

        const elapsedMs = Math.round(performance.now() - startMs);
        log.debug(
          `Enhanced full paragraph (words=${enhanced.convert_word.length}, ms=${elapsedMs}, lang=${detected.language})`,
        );
        processedElementSignature.set(
          element,
          computeTextSignature(extractTextContent(element, MAX_TEXT_LENGTH)),
        );
        return;
      }

      if (enhanced.convert_word && enhanced.convert_word.length > 0) {
        const result = injectInlineWords({
          element,
          enhanced,
          renderMode,
          enhancedTextOptions,
        });

        const elapsedMs = Math.round(performance.now() - startMs);
        log.debug(
          `Enhanced ${enhanced.convert_word.length} words (textNodes=${result.textNodes}, ms=${elapsedMs}, lang=${detected.language})`,
        );
      }

      processedElementSignature.set(
        element,
        computeTextSignature(extractTextContent(element, MAX_TEXT_LENGTH)),
      );
    } catch (error: unknown) {
      log.error("Processing error", { message: getErrorMessage(error) });
    } finally {
      element.classList.remove("lexipath-processing");
    }
  };

  const pumpQueue = () => {
    if (isEnhancePausedNow()) return;
    const token = pageProcessingToken;
    const maxInFlight = getMaxInFlight();

    while (inFlightCount < maxInFlight) {
      const el = priorityQueue.length > 0 ? priorityQueue.shift() : elementQueue[queueHead];
      if (!el) break;
      if (priorityQueue.length === 0 && el === elementQueue[queueHead]) {
        queueHead += 1;
      }

      if (!queuedElements.has(el)) continue;
      if (inFlightElements.has(el)) continue;

      inFlightElements.add(el);
      inFlightCount += 1;

      // Once a node is dequeued for processing, stop tracking it in the IntersectionObserver
      // to keep long-lived pages from accumulating thousands of observed targets.
      try {
        intersectionObserver?.unobserve(el);
      } catch {
        // Ignore observer errors; processing should proceed.
      }


      void (async () => {
        try {
          await processTextElement(el, token);
        } finally {
          inFlightCount -= 1;
          inFlightElements.delete(el);

          const backlog = getQueuedBacklogCount();
          if (backlog > 0) schedulePumpQueue();

          if (
            manualForceEnhanceMode &&
            manualForceEnhanceModeToken === token &&
            backlog <= 0 &&
            inFlightCount <= 0
          ) {
            manualForceEnhanceMode = null;
            manualForceEnhanceModeToken = 0;
          }
        }
      })();
    }
  };

  const initPageProcessing = async (opts?: { forceMode?: EnhanceWebPayload["mode"] }) => {
    resetPageProcessingState();
    manualForceEnhanceMode = opts?.forceMode ?? null;
    manualForceEnhanceModeToken = manualForceEnhanceMode ? pageProcessingToken : 0;
    log.info("Starting page processing");

    const adapter = getWebSiteAdapter(currentUrl);
    const selectorResults = document.querySelectorAll(adapter.textSelector);
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
        if (!adapter.shouldQueueElement(el)) continue;
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
    setupMutationObserver();
  };

  const runManualPageProcessingOnce = async (opts?: { forceMode?: EnhanceWebPayload["mode"] }) => {
    if (manualEnhanceInFlight) return;
    manualEnhanceInFlight = true;
    try {
      resetPageProcessingState();
      manualForceEnhanceMode = opts?.forceMode ?? null;
      manualForceEnhanceModeToken = manualForceEnhanceMode ? pageProcessingToken : 0;
      log.info("Starting manual page processing");

      const adapter = getWebSiteAdapter(currentUrl);
      const selectorResults = document.querySelectorAll(adapter.textSelector);
      log.info(
        `Found ${selectorResults.length} candidate text elements to process (manual)`,
      );

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
          if (!adapter.shouldQueueElement(el)) continue;
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
  };

  const requestEnhanceOnce = async () => {
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

    const status = await ensureWebProcessingStatus();
    if (!status?.keywordProviderConfigured || !status?.translationProviderConfigured) {
      log.warn(getI18nMessage("log_providerNotConfiguredSkipPageProcessing"));
      return;
    }

    evaluatePageEligibility(currentSettings);
    syncFloatingMeta();
    if (!pageEligibleForLearning) {
      log.info(
        `Manual enhance skipped: page language not eligible lang=${pagePrimaryLanguage ?? "unknown"}`,
      );
      return;
    }

    if (currentSettings.autoEnhance) {
      await initPageProcessing();
      return;
    }

    await runManualPageProcessingOnce();
  };

  const requestRewriteOnce = async () => {
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

    const status = await ensureWebProcessingStatus();
    if (!status?.keywordProviderConfigured || !status?.translationProviderConfigured) {
      log.warn(getI18nMessage("log_providerNotConfiguredSkipPageProcessing"));
      return;
    }

    pageEligibleForLearning = true;
    pagePrimaryLanguage = currentSettings.targetLanguage ?? pagePrimaryLanguage;
    syncFloatingMeta();

    if (currentSettings.autoEnhance) {
      await initPageProcessing({ forceMode: "full" });
      return;
    }

    await runManualPageProcessingOnce({ forceMode: "full" });
  };

  const initForUrl = async (url: string) => {
    currentUrl = url;
    currentSettings = options.getSettings();

    tooltipManager.ensureMounted();
    ensureWebStylesInjected({
      settings: currentSettings,
      theme: getResolvedTheme(currentSettings),
    });

    await refreshWebProcessingStatus();
    evaluatePageEligibility(currentSettings);
    syncFloatingMeta();

    if (!currentSettings?.enabled) return;

    const platform = detectPlatform(url);
    if (platform !== "unknown") return;

    const status = await ensureWebProcessingStatus();
    if (!status?.keywordProviderConfigured || !status?.translationProviderConfigured) {
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
      log.info(
        `Page language not eligible; skipping page processing lang=${pagePrimaryLanguage ?? "unknown"}`,
      );
      return;
    }

    await initPageProcessing();
  };

  const ensureEnhancePauseObserver = () => {
    if (enhancePauseObserver) return;

    enhancePauseObserver = new MutationObserver(() => {
      if (isEnhancePausedNow()) {
        clearPendingPageProcessingQueues();
        tooltipManager.forceHideTooltipAndCard();
        return;
      }

      if (getQueuedBacklogCount() > 0) {
        schedulePumpQueue({ eager: true });
      }
    });

    enhancePauseObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  };

  const setSettings = (settings: Settings | null) => {
    currentSettings = settings;
    ensureWebStylesInjected({
      settings: currentSettings,
      theme: getResolvedTheme(currentSettings),
    });
    syncFloatingMeta();
  };

  const destroy = () => {
    resetPageProcessingState();
    tooltipManager.destroy();

    if (enhancePauseObserver) {
      enhancePauseObserver.disconnect();
      enhancePauseObserver = null;
    }
  };

  return Object.freeze({
    setSettings,
    destroy,
    resetPageState: resetPageProcessingState,
    initForUrl,
    requestEnhanceOnce,
    requestRewriteOnce,
    ensureEnhancePauseObserver,
  });
}

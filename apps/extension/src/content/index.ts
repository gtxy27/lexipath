/**
 * LexiPath Content Script
 *
 * Orchestrates:
 * - Settings/site gating
 * - Subtitle controller for video platforms
 * - Web enhancer pipeline for normal pages
 * - Word card manager (selection explain + tooltip/card UI)
 */

import browser from "webextension-polyfill";
import { SettingsSchema, type Settings } from "@lexipath/core";
import { qualifySite } from "@lexipath/core/qualify";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { sendMessage } from "../shared/messages";
import {
  SubtitleController,
  detectPlatform,
  type Platform,
} from "./subtitles";
import { getI18nMessage } from "./i18n";
import { EnglishCorrectionController } from "./english-correction";
import { FloatingButtonController } from "./ui/floating-button-controller";
import { FLOATING_HIDE_ONCE_KEY } from "./ui/floating-button-constants";
import { createWebWordCardManager, type WebWordCardManager } from "./web";
import { createWebEnhancer, type WebEnhancer } from "./web";
import {
  applyTabEnhancePausedFromStorage,
  applyWebShowOriginal,
  toggleTabEnhancePaused,
  toggleTabShowOriginal,
} from "../shared/tab-state";

const log = createLogger("content");

let subtitleController: SubtitleController | null = null;
let englishCorrectionController: EnglishCorrectionController | null = null;
let floatingButtonController: FloatingButtonController | null = null;
let currentSettings: Settings | null = null;
let currentSiteQualified = false;

let webWordCardManager: WebWordCardManager | null = null;
let webEnhancer: WebEnhancer | null = null;
type PageContextUpdate = Parameters<FloatingButtonController["updatePageContext"]>[0];
let pendingPageContext: PageContextUpdate | null = null;

let urlPollTimer: number | null = null;
let navigationToken = 0;
let lastKnownUrl = "";

function getResolvedTheme(): "light" | "dark" {
  if (!currentSettings) return "dark";
  if (currentSettings.theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return currentSettings.theme === "dark" ? "dark" : "light";
}

function getWebWordCardManager(): WebWordCardManager {
  if (!webWordCardManager) {
    webWordCardManager = createWebWordCardManager({
      getSettings: () => currentSettings,
      getResolvedTheme,
    });
  }
  return webWordCardManager;
}

function getWebEnhancer(): WebEnhancer {
  if (!webEnhancer) {
    webEnhancer = createWebEnhancer({
      getSettings: () => currentSettings,
      getWordCardManager: getWebWordCardManager,
      onPageContextUpdate: (update) => {
        pendingPageContext = { ...(pendingPageContext ?? {}), ...update };
        floatingButtonController?.updatePageContext?.(update);
      },
    });
  }
  return webEnhancer;
}

async function getSettings(): Promise<Settings | null> {
  const response = await sendMessage("GET_SETTINGS", undefined);
  if (response.ok) {
    return response.value;
  }
  log.error("Failed to get settings", response.error);
  return null;
}

async function getWebProcessingStatus(): Promise<
  | {
      keywordProviderConfigured: boolean;
      translationProviderConfigured: boolean;
      webEnhanceConcurrencyLimit: number;
    }
  | null
> {
  const response = await sendMessage("GET_WEB_PROCESSING_STATUS", undefined);
  if (response.ok) return response.value;
  log.error("Failed to get web processing status", response.error);
  return null;
}

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

  const maxRetries = 20;
  let retries = 0;

  const checkVideoElement = async (): Promise<void> => {
    if (token !== navigationToken) return;
    const videoElement = document.querySelector("video");

    if (videoElement instanceof HTMLVideoElement) {
      if (!currentSettings) return;
      subtitleController = new SubtitleController(currentSettings);
      const success = await subtitleController.init(url);

      if (success) {
        log.info("Subtitle controller initialized");
      } else {
        log.warn("Subtitle controller initialization failed");
      }
      return;
    }

    if (retries < maxRetries) {
      retries++;
      setTimeout(checkVideoElement, 500);
      return;
    }

    log.warn("Video element not found after retries");
  };

  await checkVideoElement();
}

async function initForUrl(url: string, token: number): Promise<void> {
  currentSettings = await getSettings();
  if (token !== navigationToken) return;
  currentSiteQualified = false;

  getWebEnhancer().setSettings(currentSettings);
  getWebWordCardManager().setSettings(currentSettings);

  if (!currentSettings?.enabled) {
    log.info("Extension is disabled");
    englishCorrectionController?.setSettings(null);
    webEnhancer?.resetPageState();
    subtitleController?.destroy();
    subtitleController = null;
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
    webEnhancer?.resetPageState();
    subtitleController?.destroy();
    subtitleController = null;
    return;
  }
  currentSiteQualified = true;

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

    const status = await getWebProcessingStatus();
    if (!status?.translationProviderConfigured) {
      log.warn(getI18nMessage("log_providerNotConfiguredSkipPageProcessing"));
      return;
    }

    await initSubtitleController(platform, url, token);
    return;
  }

  subtitleController?.destroy();
  subtitleController = null;

  await getWebEnhancer().initForUrl(url);
}

function resetAllState(): void {
  subtitleController?.destroy();
  subtitleController = null;

  webEnhancer?.resetPageState();
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

  applyWebShowOriginal(Boolean(currentSettings?.webShowOriginal));
  applyTabEnhancePausedFromStorage();

  getWebWordCardManager().ensureSelectionExplainInjected();
  getWebEnhancer().ensureEnhancePauseObserver();

  if (!floatingButtonController) {
    floatingButtonController = new FloatingButtonController(currentSettings, {
      onRunWebEnhanceOnce: () => getWebEnhancer().requestEnhanceOnce(),
      onRunWebRewriteOnce: () => getWebEnhancer().requestRewriteOnce(),
    });
    floatingButtonController.mount();
  }
  if (pendingPageContext) {
    floatingButtonController.updatePageContext(pendingPageContext);
  }

  browser.storage?.onChanged?.addListener?.((changes: Record<string, browser.Storage.StorageChange>, area: string) => {
    if (area !== "local") return;
    const parsed = SettingsSchema.safeParse(changes.settings?.newValue);
    if (!parsed.success) return;
    const nextSettings = parsed.data;

    const prevFloating = currentSettings?.floatingButtonEnabled ?? true;
    currentSettings = nextSettings;

    getWebWordCardManager().setSettings(nextSettings);
    getWebEnhancer().setSettings(nextSettings);

    englishCorrectionController?.setSettings(nextSettings);
    floatingButtonController?.updateSettings(nextSettings);
    subtitleController?.setSettings(nextSettings);
    applyWebShowOriginal(Boolean(nextSettings.webShowOriginal));

    const nextFloating = nextSettings?.floatingButtonEnabled ?? true;
    if (!prevFloating && nextFloating) {
      try {
        sessionStorage.removeItem(FLOATING_HIDE_ONCE_KEY);
      } catch (error: unknown) {
        void error;
      }
    }
  });

  const MAX_SURROUNDING_CHARS = 400;

  function normalizeSelectionText(text: string): string {
    return String(text ?? "").replace(/\s+/g, " ").trim();
  }

  function takeLastBounded(text: string, maxChars: number): string {
    const normalized = normalizeSelectionText(text);
    if (normalized.length <= maxChars) return normalized;

    const sliced = normalized.slice(normalized.length - maxChars);
    const firstSpace = sliced.indexOf(" ");
    if (firstSpace > 0 && firstSpace < 40) {
      return sliced.slice(firstSpace + 1).trim();
    }
    return sliced.trim();
  }

  function takeFirstBounded(text: string, maxChars: number): string {
    const normalized = normalizeSelectionText(text);
    if (normalized.length <= maxChars) return normalized;

    const sliced = normalized.slice(0, maxChars);
    const lastSpace = sliced.lastIndexOf(" ");
    if (lastSpace > maxChars - 40) {
      return sliced.slice(0, lastSpace).trim();
    }
    return sliced.trim();
  }

  function getWebSelectionContext():
    | {
        kind: "web";
        source: "selection";
        title?: string;
        domain?: string;
        url?: string;
        selectedText?: string;
        beforeText?: string;
        afterText?: string;
      }
    | null {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const selectedText = normalizeSelectionText(selection.toString());
    if (!selectedText) return null;

    const title = normalizeSelectionText(document.title);
    const domain = normalizeSelectionText(window.location.hostname);

    try {
      const range = selection.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const el =
        node instanceof Element
          ? node
          : node && (node as any).parentElement instanceof Element
            ? (node as any).parentElement
            : null;

      const container =
        (el?.closest?.("p, li, blockquote, dd, dt, article, section, main, div") as HTMLElement | null) ??
        (el as HTMLElement | null) ??
        document.body;

      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(container);
      beforeRange.setEnd(range.startContainer, range.startOffset);

      const afterRange = document.createRange();
      afterRange.selectNodeContents(container);
      afterRange.setStart(range.endContainer, range.endOffset);

      const beforeText = takeLastBounded(beforeRange.toString(), MAX_SURROUNDING_CHARS);
      const afterText = takeFirstBounded(afterRange.toString(), MAX_SURROUNDING_CHARS);

      return {
        kind: "web",
        source: "selection",
        ...(title ? { title } : {}),
        ...(domain ? { domain } : {}),
        url: window.location.href,
        selectedText,
        ...(beforeText ? { beforeText } : {}),
        ...(afterText ? { afterText } : {}),
      };
    } catch {
      return {
        kind: "web",
        source: "selection",
        ...(title ? { title } : {}),
        ...(domain ? { domain } : {}),
        url: window.location.href,
        selectedText,
      };
    }
  }

  browser.runtime?.onMessage?.addListener?.((message: unknown) => {
    if (!message || typeof message !== "object") return;
    const type = (message as Record<string, unknown>).type;

    switch (type) {
    case "LEXIPATH_TOGGLE_ORIGINAL_TAB": {
      if (!currentSettings) return;
      toggleTabShowOriginal(Boolean(currentSettings.webShowOriginal));
      return;
    }
    case "LEXIPATH_TOGGLE_ENHANCE_PAUSED_TAB": {
      if (!currentSettings) return;
      toggleTabEnhancePaused();
      return;
    }
    case "LEXIPATH_TOGGLE_SUBTITLE_BILINGUAL": {
      subtitleController?.toggleBilingualMode();
      return;
    }
    case "LEXIPATH_GET_WEB_SELECTION_CONTEXT": {
      const context = getWebSelectionContext();
      return Promise.resolve(context ?? undefined);
    }
    default:
      return;
    }
  });
}

function cleanup(): void {
  if (urlPollTimer !== null) {
    window.clearInterval(urlPollTimer);
    urlPollTimer = null;
  }
  resetAllState();
  webEnhancer?.destroy();
  webEnhancer = null;

  englishCorrectionController?.destroy();
  englishCorrectionController = null;
}

const runInit = () => {
  init().catch((error) => {
    log.error("Init failed", { message: getErrorMessage(error) });
  });
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", runInit);
} else {
  runInit();
}

window.addEventListener("beforeunload", cleanup);

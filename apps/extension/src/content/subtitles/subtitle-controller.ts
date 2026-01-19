/**
 * Subtitle Controller
 *
 * Manages subtitle fetching, enhancement, and synchronization with video playback.
 * Supports YouTube and Bilibili platforms.
 */

import browser from 'webextension-polyfill';
import type { Cue, Settings, SupportedLanguage } from '@lexipath/core';
import { createLogger, getErrorMessage } from '@lexipath/core/log';
import { sendMessage } from '../../shared/messages';
import { SubtitleOverlay, type SubtitleMode, type SubtitleLine, type WordCardData } from '../ui';
import { createSubtitleProvider } from './subtitle-providers/create-subtitle-provider';
import type { SubtitleProvider } from './subtitle-providers/subtitle-provider';
import { getI18nMessage } from '../i18n';
import { SubtitleVideoSync } from './subtitle-video-sync';
import { SubtitleEnhancer } from './subtitle-enhancer';
import { BilibiliDanmuManager } from './bilibili-danmu-manager';
import { resolveWordCardTtsLang } from '../wordcard';
import { PlatformCaptionsWatcher } from './platform-captions-watcher';
import {
  buildCueContextWindow,
  clampContextSentences,
  computeContextSignature,
  computeKeywordTranslationSignature,
  computeTextSignature,
  normalizeSupportedLanguageCode,
  normalizeTerm,
} from './subtitle-utils';

export { detectPlatform } from './subtitle-platform';
export type { Platform } from './subtitle-platform';

const SLOW_LOG_THRESHOLD_MS = 800;
const DEBUG_LOG_THROTTLE_MS = 1500;
const log = createLogger('subtitle-controller');
const INTERACTIVE_WORD_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'doing', 'for', 'from', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'him', 'his', 'how', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'just', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'out', 'over',
  'she', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'too',
  'under', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with',
  'would', 'you', 'your',
]);

/**
 * Subtitle Controller
 */
export class SubtitleController {
  private destroyed = false;
  private provider: SubtitleProvider | null = null;
  private overlay: SubtitleOverlay | null = null;
  private cues: Cue[] = [];
  private currentCueIndex: number = -1;
  private videoElement: HTMLVideoElement | null = null;
  private videoSync: SubtitleVideoSync | null = null;
  private enhancer: SubtitleEnhancer | null = null;
  private mode: SubtitleMode = 'enhanced';
  private tempBilingualKeyPressed: boolean = false;

  private statusMessage = '';
  private cuesGeneration = 0;
  private subtitlesFetchPromise: Promise<void> | null = null;
  private subtitleLanguage = '';
  private wordExplainCache = new Map<string, WordCardData>();
  private wordExplainInFlight = new Map<string, Promise<WordCardData>>();
  private currentSubtitleContext = '';
  private cueKeywords = new Map<string, string[]>();
  private cueKeywordSignatures = new Map<string, string>();
  private cueKeywordsInFlight = new Map<string, Promise<string[]>>();
  private cueKeywordTranslations = new Map<string, Record<string, string>>();
  private cueKeywordTranslationSignatures = new Map<string, string>();
  private cueKeywordTranslationsInFlight = new Map<string, Promise<Record<string, string>>>();

  private readonly keywordPrefetchLookaheadMs = 15_000;
  private prefetchToken = 0;
  private prefetchQueue: Array<{ term: string; context: string }> = [];
  private prefetchQueuedTerms = new Set<string>();
  private prefetchInFlight = 0;
  private maxPrefetchInFlight = 5;
  private debugLastPrefetchSummaryAt = 0;
  private debugLastPrefetchSaturationAt = 0;

  // Prefetch bilingual (native) translations so the 2nd line can keep up in bilingual mode.
  private bilingualPrefetchQueue: Cue[] = [];
  private bilingualPrefetchQueuedCueIds = new Set<string>();
  private bilingualPrefetchInFlight = 0;
  private maxBilingualPrefetchInFlight = 2;
  private debugLastBilingualPrefetchSaturationAt = 0;

  private platformCaptionsEnabled: boolean | null = null;
  private platformCaptionsWatcher: PlatformCaptionsWatcher | null = null;
  private danmuManager: BilibiliDanmuManager | null = null;

  constructor(private settings: Settings) {}

  private getResolvedTheme(): 'light' | 'dark' {
    if (this.settings.theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return this.settings.theme === 'dark' ? 'dark' : 'light';
  }

  /**
   * Set theme
   */
  setTheme(theme: 'light' | 'dark' | 'system'): void {
    this.settings.theme = theme;
    if (this.overlay) {
      this.overlay.setTheme(this.getResolvedTheme());
    }
  }

  setSettings(settings: Settings): void {
    this.settings = settings;
    if (this.overlay) {
      this.overlay.setTheme(this.getResolvedTheme());
      this.overlay.setWordCardConfig({
        sectionsOrder: settings.wordCardSectionsOrder,
        autoPronounce: settings.wordCardAutoPronounce,
        ttsLang: resolveWordCardTtsLang(settings),
      });
    }
    this.maxPrefetchInFlight = this.getPrefetchConcurrencyLimit();
    this.maxBilingualPrefetchInFlight = this.getBilingualPrefetchConcurrencyLimit();
  }

  private isVideoPaused(): boolean {
    return Boolean(this.videoElement?.paused);
  }

  private getPrefetchConcurrencyLimit(): number {
    const route = (() => {
      const config = this.settings.behaviorRoutes?.select_keywords;
      if (!config || config.kind !== 1) return null;
      return this.settings.channels.find((channel) => channel.channelId === config.channelId) ?? null;
    })();

    const channelLimit = typeof route?.concurrencyLimit === 'number' && Number.isFinite(route.concurrencyLimit)
      ? route.concurrencyLimit
      : 15;
    // Reserve headroom for user hover/click; prefetch uses ~25% of model concurrency, capped.
    const suggested = Math.floor(channelLimit / 4);
    return Math.min(20, Math.max(2, suggested || 2));
  }

  private getBilingualPrefetchConcurrencyLimit(): number {
    const routeConfig = this.settings.behaviorRoutes?.translate;
    if (!routeConfig) return 2;

    if (routeConfig.kind === 2 || routeConfig.kind === 3) return 4;
    if (routeConfig.kind !== 1) return 2;

    const channel = this.settings.channels.find((c) => c.channelId === routeConfig.channelId) ?? null;
    const channelLimit =
      typeof channel?.concurrencyLimit === 'number' && Number.isFinite(channel.concurrencyLimit) ? channel.concurrencyLimit : 8;

    // Keep this conservative: bilingual prefetch is user-visible and should not starve interactive calls.
    const suggested = Math.floor(channelLimit / 4);
    return Math.min(6, Math.max(1, suggested || 1));
  }

  /**
   * Initialize controller
   */
  async init(url: string): Promise<boolean> {
    this.provider = createSubtitleProvider(url, {
      onSubtitlesMayBeAvailable: () => {
        if (!this.destroyed) void this.fetchAndProcessSubtitles();
      },
    });

    if (!this.provider) {
      log.info('Unsupported platform or invalid URL');
      return false;
    }

    try {
      await this.provider.init(url, this.settings);
    } catch (error) {
      log.error('Provider init failed', { message: getErrorMessage(error) });
      this.provider.destroy();
      this.provider = null;
      return false;
    }

    // Find video element
    this.videoElement = this.findVideoElement();
    if (!this.videoElement) {
      log.error('Video element not found');
      this.provider.destroy();
      this.provider = null;
      return false;
    }

    this.videoElement.addEventListener('play', this.handleVideoPlay);
    this.videoElement.addEventListener('pause', this.handleVideoPause);

    this.videoSync = new SubtitleVideoSync({
      onCueIndexChange: (index) => {
        this.currentCueIndex = index;
        this.updateSubtitleDisplay();
        this.startPrefetchWindow();
      },
    });
    this.videoSync.setVideoElement(this.videoElement);

    this.enhancer = new SubtitleEnhancer({
      isPaused: () => this.isVideoPaused(),
      sendEnhanceSubtitle: (payload) => sendMessage('ENHANCE_SUBTITLE', payload),
      getSourceLang: (cue, subtitleLanguage) => this.getCueSourceLanguage(cue, subtitleLanguage),
      getContextWindowSize: () => this.clampContextSentences(this.settings.llmContextSentences),
      onCueEnhanced: (cueId) => {
        const currentCue = this.currentCueIndex >= 0 ? this.cues[this.currentCueIndex] : null;
        if (currentCue?.id === cueId) {
          this.updateSubtitleDisplay();
        }
      },
    });

    if (this.provider.platform === 'bilibili') {
      this.danmuManager = new BilibiliDanmuManager();
    }

    const isYouTubeShorts =
      this.provider.platform === 'youtube' && url.toLowerCase().includes('youtube.com/shorts/');

    // Create overlay
    this.overlay = new SubtitleOverlay(this.provider.platform, {
      theme: this.getResolvedTheme(),
      ...(isYouTubeShorts ? { layout: 'youtube-shorts' } : {}),
      onModeChange: (mode) => {
        this.mode = mode;
        this.updateSubtitleDisplay();
      },
      onWordClick: (word, anchorRect) => {
        void this.handleSubtitleWordClick(word, anchorRect);
      },
      onWordHover: (word, anchorRect) => {
        void this.handleSubtitleWordHover(word, anchorRect);
      },
    });
    this.overlay.setWordCardConfig({
      sectionsOrder: this.settings.wordCardSectionsOrder,
      autoPronounce: this.settings.wordCardAutoPronounce,
      ttsLang: resolveWordCardTtsLang(this.settings),
    });

    // Mount overlay
    const mounted = this.overlay.mount();
    if (!mounted) {
      log.error('Failed to mount overlay');
      this.overlay = null;
      this.enhancer?.destroy();
      this.enhancer = null;
      this.videoSync?.destroy();
      this.videoSync = null;
      this.videoElement.removeEventListener('play', this.handleVideoPlay);
      this.videoElement.removeEventListener('pause', this.handleVideoPause);
      this.videoElement = null;
      this.provider.destroy();
      this.provider = null;
      return false;
    }

    this.startPlatformCaptionsWatch();

    this.maxPrefetchInFlight = this.getPrefetchConcurrencyLimit();
    this.maxBilingualPrefetchInFlight = this.getBilingualPrefetchConcurrencyLimit();

    // Fetch subtitles
    await this.fetchAndProcessSubtitles();

    // Start sync loop
    this.videoSync.start();

    // Setup keyboard listener for temporary bilingual mode
    this.setupKeyboardListener();

    log.info('Initialized successfully');
    return true;
  }

  /**
   * Destroy controller and cleanup
   */
  destroy(): void {
    this.destroyed = true;
    this.prefetchToken++;
    this.prefetchQueue = [];
    this.prefetchQueuedTerms.clear();
    this.bilingualPrefetchQueue = [];
    this.bilingualPrefetchQueuedCueIds.clear();
    this.bilingualPrefetchInFlight = 0;
    this.stopPlatformCaptionsWatch();
    this.videoSync?.destroy();
    this.videoSync = null;
    this.enhancer?.destroy();
    this.enhancer = null;
    this.overlay?.unmount();
    this.overlay = null;
    this.provider?.destroy();
    this.provider = null;
    this.danmuManager?.destroy();
    this.danmuManager = null;
    this.videoElement?.removeEventListener('play', this.handleVideoPlay);
    this.videoElement?.removeEventListener('pause', this.handleVideoPause);
    this.videoElement = null;
    this.cues = [];
    this.subtitleLanguage = '';
    this.cueKeywords.clear();
    this.cueKeywordSignatures.clear();
    this.cueKeywordsInFlight.clear();
    this.cueKeywordTranslations.clear();
    this.cueKeywordTranslationSignatures.clear();
    this.cueKeywordTranslationsInFlight.clear();
    this.currentCueIndex = -1;
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
  }

  /**
   * Fetch subtitles and process them
   */
  private async fetchAndProcessSubtitles(): Promise<void> {
    if (this.subtitlesFetchPromise) return this.subtitlesFetchPromise;
    this.subtitlesFetchPromise = this.fetchAndProcessSubtitlesOnce().finally(() => {
      this.subtitlesFetchPromise = null;
    });
    return this.subtitlesFetchPromise;
  }

  private async fetchAndProcessSubtitlesOnce(): Promise<void> {
    const provider = this.provider;
    if (!provider) return;

    // Respect the platform subtitle toggle. For Bilibili, avoid network fetching
    // when captions are explicitly disabled by the user.
    if (provider.platform === 'bilibili' && this.platformCaptionsEnabled === false) {
      return;
    }

    try {
      const result = await provider.fetchSubtitles();
      this.statusMessage = result.statusMessage ?? '';

      if (!this.appendCuesIfPossible(result.cues, result.lang)) {
        this.setCues(result.cues, result.lang);
      }
      log.info(`Fetched ${result.cues.length} subtitle cues`);
    } catch (error) {
      log.error('Failed to fetch subtitles', { message: getErrorMessage(error) });
    }
  }

  private appendCuesIfPossible(nextCues: Cue[], lang?: string): boolean {
    if (this.cues.length === 0) return false;
    if (nextCues.length <= this.cues.length) return false;

    for (let i = 0; i < this.cues.length; i++) {
      const prev = this.cues[i];
      const next = nextCues[i];
      if (!prev || !next || prev.id !== next.id) {
        return false;
      }
    }

    this.cues = nextCues;
    this.subtitleLanguage = typeof lang === 'string' ? lang : nextCues[0]?.lang ?? this.subtitleLanguage;
    this.videoSync?.setCues(nextCues);
    this.enhancer?.appendCues(nextCues, { subtitleLanguage: this.subtitleLanguage });
    this.updateModeLabels();
    this.updateSubtitleDisplay();
    return true;
  }

  private setCues(cues: Cue[], lang?: string): void {
    this.cuesGeneration++;
    this.cues = cues;
    this.subtitleLanguage = typeof lang === 'string' ? lang : cues[0]?.lang ?? '';
    this.currentCueIndex = -1;
    this.videoSync?.setCues(cues);
    this.enhancer?.setCues(cues, { token: this.cuesGeneration, subtitleLanguage: this.subtitleLanguage });
    this.cueKeywords.clear();
    this.cueKeywordSignatures.clear();
    this.cueKeywordsInFlight.clear();
    this.cueKeywordTranslations.clear();
    this.cueKeywordTranslationSignatures.clear();
    this.cueKeywordTranslationsInFlight.clear();

    this.updateModeLabels();

    if (cues.length > 0) {
      this.statusMessage = '';
      if (this.platformCaptionsEnabled !== false) {
        const cueLang = this.getCueSourceLanguage(cues[0]!, this.subtitleLanguage);
        if (this.isSubtitleSceneEnabled(cueLang)) {
          this.provider?.hideNativeCaptions?.();
        } else {
          this.provider?.showNativeCaptions?.();
        }
      }
      this.videoSync?.syncOnce();

      const cueLang = this.getCueSourceLanguage(cues[0]!, this.subtitleLanguage);
      if (!this.isSubtitleSceneEnabled(cueLang)) {
        this.enhancer?.stop();
        this.overlay?.clear();
        this.danmuManager?.onSubtitleHidden();
        log.info('Subtitle scene disabled by settings', { cueLang });
        return;
      }

      if (this.shouldAdaptSubtitle(cueLang)) {
        this.enhancer?.start();
        log.info('Enhancer started (adapt mode)');
      } else {
        log.info('Enhancer disabled (direct mode)');
      }
    } else {
      this.provider?.showNativeCaptions?.();
      this.renderStatusMessage();
      this.danmuManager?.onSubtitleHidden();
    }
  }

  private renderStatusMessage(): void {
    if (!this.overlay) return;
    if (!this.statusMessage.trim()) {
      this.overlay.clear();
      return;
    }
    this.overlay.display({
      mode: this.mode,
      lines: [{ text: this.statusMessage, isEnhanced: false }],
    });
  }

  /**
   * Find video element on page
   */
  private findVideoElement(): HTMLVideoElement | null {
    const video = document.querySelector('video');
    return video instanceof HTMLVideoElement ? video : null;
  }

  /**
   * Update subtitle display based on current cue and mode
   */
  private updateSubtitleDisplay(): void {
    if (!this.overlay) return;

    if (this.platformCaptionsEnabled === false) {
      this.provider?.showNativeCaptions?.();
      this.overlay.clear();
      this.danmuManager?.onSubtitleHidden();
      return;
    }

    if (this.cues.length === 0) {
      this.renderStatusMessage();
      this.danmuManager?.onSubtitleHidden();
      return;
    }

    // Clear if no current cue
    if (this.currentCueIndex < 0 || this.currentCueIndex >= this.cues.length) {
      this.overlay.clear();
      this.danmuManager?.onSubtitleHidden();
      return;
    }

    const cue = this.cues[this.currentCueIndex];
    if (!cue) {
      this.overlay.clear();
      this.danmuManager?.onSubtitleHidden();
      return;
    }

    const cueLang = this.getCueSourceLanguage(cue, this.subtitleLanguage);
    if (!this.isSubtitleSceneEnabled(cueLang)) {
      this.enhancer?.stop();
      this.provider?.showNativeCaptions?.();
      this.overlay.clear();
      this.danmuManager?.onSubtitleHidden();
      return;
    }
    const shouldAdapt = this.shouldAdaptSubtitle(cueLang);

    const enhanced = this.enhancer?.getEnhanced(cue.id);
    const effectiveMode = this.tempBilingualKeyPressed ? 'bilingual-temp' : this.mode;
    const loadingTranslationText = getI18nMessage('subtitle_loadingTranslation');

    let lines: SubtitleLine[] = [];

    if (effectiveMode === 'enhanced') {
      if (shouldAdapt) {
        const adapted = typeof enhanced?.line1_final === 'string' ? enhanced.line1_final.trim() : '';
        lines = [
          {
            text: adapted || cue.text,
            isEnhanced: Boolean(adapted),
          },
        ];
        if (!adapted) {
          this.enhancer?.start();
        }
      } else {
        lines = [
          {
            text: cue.text,
            isEnhanced: false,
          },
        ];
      }
    } else {
      if (shouldAdapt) {
        const adapted = typeof enhanced?.line1_final === 'string' ? enhanced.line1_final.trim() : '';
        lines = [
          {
            text: adapted || loadingTranslationText || cue.text,
            isEnhanced: Boolean(adapted),
          },
          {
            text: cue.text,
            isEnhanced: false,
          },
        ];
        if (!adapted) {
          this.enhancer?.start();
        }
      } else {
        const translation = typeof enhanced?.line2_final === 'string' ? enhanced.line2_final.trim() : '';
        if (!translation) {
          void this.enhancer?.ensureBilingual(cue);
        }

        lines = [
          {
            text: cue.text,
            isEnhanced: false,
          },
          {
            text: translation || loadingTranslationText,
            isEnhanced: false,
          },
        ];
      }
    }

    const keywordText = shouldAdapt
      ? typeof enhanced?.line1_final === 'string' && enhanced.line1_final.trim()
        ? enhanced.line1_final
        : ''
      : cue.text;

    this.currentSubtitleContext = keywordText || cue.text;

    if (keywordText) {
      void this.ensureCueKeywords(cue.id, keywordText, this.currentCueIndex);
    }

    const trimmedKeywordText = keywordText.trim();
    const cueIndex = this.currentCueIndex;
    const contextWindow =
      trimmedKeywordText && cueIndex >= 0
        ? this.buildCueContextWindow(cueIndex, trimmedKeywordText)
        : trimmedKeywordText
          ? { before: [trimmedKeywordText], after: [] }
          : { before: [], after: [] };
    const contextSig = trimmedKeywordText ? this.computeContextSignature(contextWindow) : '';
    const keywordSignatureBase = trimmedKeywordText ? this.computeTextSignature(trimmedKeywordText) : '';
    const keywordSignature = contextSig ? `${keywordSignatureBase}|ctx:${contextSig}` : keywordSignatureBase;
    const keywords =
      trimmedKeywordText && this.cueKeywordSignatures.get(cue.id) === keywordSignature
        ? this.cueKeywords.get(cue.id)
        : undefined;

    if (keywordText && keywords && keywords.length > 0) {
      void this.ensureCueKeywordTranslations(cue.id, keywordText, keywords, this.currentCueIndex);
    }

    const translationSignatureBase =
      trimmedKeywordText && keywords && keywords.length > 0
        ? this.computeKeywordTranslationSignature(trimmedKeywordText, keywords)
        : '';
    const translationSignature =
      translationSignatureBase && contextSig ? `${translationSignatureBase}|ctx:${contextSig}` : translationSignatureBase;
    const keywordTranslations =
      translationSignature && this.cueKeywordTranslationSignatures.get(cue.id) === translationSignature
        ? this.cueKeywordTranslations.get(cue.id)
        : undefined;
    const interactiveWords =
      keywords && keywords.length > 0
        ? new Set(keywords.map((term) => this.normalizeTerm(term)))
        : this.computeInteractiveWords(lines.map((line) => line.text));

    const displayOptions: Parameters<SubtitleOverlay['display']>[0] = {
      mode: effectiveMode,
      lines,
      interactiveWords,
      showKeywordTranslations: effectiveMode === 'enhanced',
      ...(keywordTranslations ? { keywordTranslations } : {}),
    };
    this.overlay.display(displayOptions);
    this.danmuManager?.onSubtitleVisible();
  }

  private startPlatformCaptionsWatch(): void {
    this.platformCaptionsWatcher?.stop();

    const provider = this.provider;
    if (!provider) return;
    if (provider.platform !== 'youtube' && provider.platform !== 'bilibili') return;

    this.platformCaptionsWatcher = new PlatformCaptionsWatcher(provider.platform, (enabled) => {
      if (this.destroyed) return;
      if (this.platformCaptionsEnabled === enabled) return;

      this.platformCaptionsEnabled = enabled;
      if (!enabled) {
        this.provider?.showNativeCaptions?.();
      } else if (this.cues.length > 0) {
        const cue = (this.currentCueIndex >= 0 ? this.cues[this.currentCueIndex] : this.cues[0]) ?? null;
        const cueLang = cue ? this.getCueSourceLanguage(cue, this.subtitleLanguage) : null;
        const sceneEnabled = cueLang ? this.isSubtitleSceneEnabled(cueLang) : true;
        if (sceneEnabled) {
          this.provider?.hideNativeCaptions?.();
        } else {
          this.provider?.showNativeCaptions?.();
        }
      } else {
        // Subtitles were previously gated by the platform caption toggle (notably Bilibili).
        // Once the user enables captions, fetch cues so the overlay can start working.
        void this.fetchAndProcessSubtitles();
      }

      this.updateSubtitleDisplay();
    });

    this.platformCaptionsWatcher.start();
  }

  private stopPlatformCaptionsWatch(): void {
    this.platformCaptionsWatcher?.stop();
    this.platformCaptionsWatcher = null;
    this.platformCaptionsEnabled = null;
  }

  private async ensureCueBilingual(cue: Cue): Promise<void> {
    await this.enhancer?.ensureBilingual(cue);
    this.updateSubtitleDisplay();
  }

  private getCueSourceLanguage(cue: Cue, subtitleLanguage: string): SupportedLanguage {
    const candidates = [subtitleLanguage, cue.lang, this.settings.targetLanguage];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const normalized = normalizeSupportedLanguageCode(candidate);
      if (normalized) return normalized;
    }
    return this.settings.targetLanguage;
  }

  private isSubtitleSceneEnabled(subtitleLang: SupportedLanguage): boolean {
    const scenes = this.settings.scenesEnabled;
    if (!scenes) return true;
 
    const nativeLang =
      normalizeSupportedLanguageCode(this.settings.nativeLanguage) ?? this.settings.targetLanguage;
 
    if (subtitleLang === nativeLang) return scenes.videoNative !== false;
    if (subtitleLang === this.settings.targetLanguage) return scenes.videoTarget !== false;
    return true;
  }

  private shouldAdaptSubtitle(subtitleLang: SupportedLanguage): boolean {
    if (subtitleLang === this.settings.targetLanguage) return false;
 
    const nativeLang =
      normalizeSupportedLanguageCode(this.settings.nativeLanguage) ?? this.settings.targetLanguage;
    if (subtitleLang === nativeLang) return true;
 
    return true;
  }

  private updateModeLabels(): void {
    const overlay = this.overlay;
    if (!overlay) return;

    const labelFor = (lang: SupportedLanguage): { full: string; short: string } => {
      const full = getI18nMessage(`languageTarget_${lang}`, undefined, lang.toUpperCase());
      return { full, short: lang.toUpperCase() };
    };

    const target = labelFor(this.settings.targetLanguage);
    const nativeLang =
      normalizeSupportedLanguageCode(this.settings.nativeLanguage) ?? this.settings.targetLanguage;
    const native = labelFor(nativeLang);

    const bilingual = `${native.short}${target.short}`;
    const bilingualTemp = getI18nMessage('subtitle_modeBilingualHoldCode', [bilingual], bilingual);

    overlay.setModeLabels({
      enhanced: target.full,
      bilingual,
      bilingualTemp,
    });
  }

  private clampContextSentences(raw: unknown): number {
    return clampContextSentences(raw, 6);
  }

  private buildCueContextWindow(centerIndex: number, centerText: string): { before: string[]; after: string[] } {
    return buildCueContextWindow({
      cues: this.cues,
      centerIndex,
      centerText,
      windowSize: this.clampContextSentences(this.settings.llmContextSentences),
    });
  }

  private computeContextSignature(window: { before: string[]; after: string[] }): string {
    return computeContextSignature(window);
  }

  private normalizeTerm(term: string): string {
    return normalizeTerm(term);
  }

  private computeTextSignature(text: string): string {
    return computeTextSignature(text);
  }

  private ensureCueKeywords(cueId: string, text: string, cueIndex?: number): Promise<string[]> {
    const trimmed = text.trim();
    if (!trimmed) return Promise.resolve([]);

    const idx = typeof cueIndex === 'number' ? cueIndex : this.cues.findIndex((cue) => cue?.id === cueId);
    const contextWindow = idx >= 0 ? this.buildCueContextWindow(idx, trimmed) : { before: [trimmed], after: [] };
    const contextSig = this.computeContextSignature(contextWindow);
    const signature = contextSig ? `${this.computeTextSignature(trimmed)}|ctx:${contextSig}` : this.computeTextSignature(trimmed);
    if (this.cueKeywordSignatures.get(cueId) === signature && this.cueKeywords.has(cueId)) {
      return Promise.resolve(this.cueKeywords.get(cueId) ?? []);
    }

    const inFlightKey = `${cueId}:${signature}`;
    const inFlight = this.cueKeywordsInFlight.get(inFlightKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const startedAt = performance.now();
      const response = await sendMessage('SELECT_KEYWORDS', {
        text: trimmed,
        scene: 'subtitle',
        ...((contextWindow.before.length || contextWindow.after.length)
          ? { contextBefore: contextWindow.before, contextAfter: contextWindow.after }
          : {}),
      });
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (elapsedMs >= SLOW_LOG_THRESHOLD_MS) {
        log.debug(`SELECT_KEYWORDS slow cueId=${cueId} ms=${elapsedMs}`);
      }
      if (!response.ok) return [];
      return response.value;
    })()
      .then((keywords) => {
        this.cueKeywords.set(cueId, keywords);
        this.cueKeywordSignatures.set(cueId, signature);
        if (keywords.length > 0) {
          void this.ensureCueKeywordTranslations(cueId, trimmed, keywords, idx);
        }
        const currentCue = this.cues[this.currentCueIndex];
        if (currentCue?.id === cueId) {
          this.updateSubtitleDisplay();
        }
        return keywords;
      })
      .catch((error: unknown) => {
        log.warn('Failed to fetch keywords for cue; returning empty list', { cueId, message: getErrorMessage(error) });
        return [] as string[];
      })
      .finally(() => {
        this.cueKeywordsInFlight.delete(inFlightKey);
      });

    this.cueKeywordsInFlight.set(inFlightKey, promise);
    return promise;
  }

  private computeKeywordTranslationSignature(text: string, keywords: string[]): string {
    return computeKeywordTranslationSignature(text, keywords);
  }

  private ensureCueKeywordTranslations(
    cueId: string,
    contextText: string,
    keywords: string[],
    cueIndex?: number
  ): Promise<Record<string, string>> {
    const trimmedContext = contextText.trim();
    if (!trimmedContext) return Promise.resolve({});
    if (keywords.length === 0) return Promise.resolve({});

    const idx = typeof cueIndex === 'number' ? cueIndex : this.cues.findIndex((cue) => cue?.id === cueId);
    const contextWindow = idx >= 0 ? this.buildCueContextWindow(idx, trimmedContext) : { before: [trimmedContext], after: [] };
    const contextSig = this.computeContextSignature(contextWindow);
    const signatureBase = this.computeKeywordTranslationSignature(trimmedContext, keywords);
    const signature = contextSig ? `${signatureBase}|ctx:${contextSig}` : signatureBase;
    if (this.cueKeywordTranslationSignatures.get(cueId) === signature && this.cueKeywordTranslations.has(cueId)) {
      return Promise.resolve(this.cueKeywordTranslations.get(cueId) ?? {});
    }

    const inFlightKey = `${cueId}:${signature}`;
    const inFlight = this.cueKeywordTranslationsInFlight.get(inFlightKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const response = await sendMessage('TRANSLATE_KEYWORDS', {
        keywords,
        ...(contextWindow.before.length || contextWindow.after.length
          ? { contextBefore: contextWindow.before, contextAfter: contextWindow.after }
          : { context: trimmedContext }),
        sourceLang: this.settings.targetLanguage,
        targetLang: this.settings.nativeLanguage,
      });

      if (!response.ok) return {};
      const translated = response.value;

      const mapping: Record<string, string> = {};
      for (let i = 0; i < keywords.length; i++) {
        const term = this.normalizeTerm(keywords[i] ?? '');
        if (!term) continue;
        const value = typeof translated[i] === 'string' && translated[i]!.trim() ? translated[i]!.trim() : keywords[i] ?? term;
        if (!(term in mapping)) {
          mapping[term] = value;
        }
      }

      return mapping;
    })()
      .then((mapping) => {
        this.cueKeywordTranslations.set(cueId, mapping);
        this.cueKeywordTranslationSignatures.set(cueId, signature);
        const currentCue = this.cues[this.currentCueIndex];
        if (currentCue?.id === cueId) {
          this.updateSubtitleDisplay();
        }
        return mapping;
      })
      .catch((error: unknown) => {
        log.warn('Failed to translate cue keywords; returning empty mapping', { cueId, message: getErrorMessage(error) });
        return {} as Record<string, string>;
      })
      .finally(() => {
        this.cueKeywordTranslationsInFlight.delete(inFlightKey);
      });

    this.cueKeywordTranslationsInFlight.set(inFlightKey, promise);
    return promise;
  }

  private startPrefetchWindow(): void {
    if (!this.videoElement) return;
    if (this.cues.length === 0) return;
    if (this.currentCueIndex < 0) return;
    if (this.isVideoPaused()) return;

    const token = ++this.prefetchToken;
    this.prefetchQueue = [];
    this.prefetchQueuedTerms.clear();
    this.bilingualPrefetchQueue = [];
    this.bilingualPrefetchQueuedCueIds.clear();
    this.bilingualPrefetchInFlight = 0;

    void this.prefetchAhead(token);
  }

  private async prefetchAhead(token: number): Promise<void> {
    if (!this.videoElement) return;
    if (this.destroyed) return;
    if (token !== this.prefetchToken) return;
    if (this.isVideoPaused()) return;

    const prefetchStartedAt = performance.now();
    const nowMs = this.videoElement.currentTime * 1000;
    const windowEndMs = nowMs + this.keywordPrefetchLookaheadMs;

    const cuesInWindow: Cue[] = [];

      let startIndex = Math.max(0, this.currentCueIndex);
      if (this.currentCueIndex < 0 || this.currentCueIndex >= this.cues.length) {
        startIndex = this.videoSync?.findFirstCueIndexAfterTimeMs(nowMs) ?? startIndex;
      } else {
        const cue = this.cues[this.currentCueIndex];
        if (!cue || cue.endMs <= nowMs) {
          startIndex = this.videoSync?.findFirstCueIndexAfterTimeMs(nowMs) ?? startIndex;
        }
      }

    for (let i = startIndex; i < this.cues.length; i++) {
      const cue = this.cues[i];
      if (!cue) continue;
      if (cue.startMs >= windowEndMs) break;
      if (cue.endMs <= nowMs) continue;
      cuesInWindow.push(cue);
    }

    const summaryNow = Date.now();
    if (summaryNow - this.debugLastPrefetchSummaryAt >= DEBUG_LOG_THROTTLE_MS) {
      this.debugLastPrefetchSummaryAt = summaryNow;
      log.debug(
        `Prefetch window cues=${cuesInWindow.length} nowMs=${Math.round(nowMs)} lookaheadMs=${this.keywordPrefetchLookaheadMs}`
      );
    }

    // Kick off bilingual (native) subtitle translation prefetch in parallel with keyword requests.
    // Only applies to cues that do NOT require subtitle adaptation (i.e. cue language matches target learning language).
    const wantsBilingual = this.mode === 'bilingual' || this.tempBilingualKeyPressed;
    if (wantsBilingual) {
      for (const cue of cuesInWindow) {
        if (!cue) continue;
        const cueLang = this.getCueSourceLanguage(cue, this.subtitleLanguage);
        if (this.shouldAdaptSubtitle(cueLang)) continue;
        this.queueBilingualPrefetch(cue, token);
      }
    }

    const keywordLists = await Promise.all(
      cuesInWindow.map((cue, idx) => {
        const cueIndex = startIndex + idx;
        const cueLang = this.getCueSourceLanguage(cue, this.subtitleLanguage);
        if (!this.shouldAdaptSubtitle(cueLang)) {
          return this.ensureCueKeywords(cue.id, cue.text, cueIndex);
        }

        const adapted = this.enhancer?.getEnhanced(cue.id)?.line1_final?.trim() ?? '';
        if (!adapted) return Promise.resolve([]);
        return this.ensureCueKeywords(cue.id, adapted, cueIndex);
      })
    );

    if (this.destroyed) return;
    if (token !== this.prefetchToken) {
      log.debug(
        `Prefetch aborted (token changed) cues=${cuesInWindow.length} waitedMs=${Math.round(performance.now() - prefetchStartedAt)}`
      );
      return;
    }

    const termContexts = new Map<string, string>();
    for (let i = 0; i < cuesInWindow.length; i++) {
      const cue = cuesInWindow[i];
      if (!cue) continue;
      const cueLang = this.getCueSourceLanguage(cue, this.subtitleLanguage);
      const shouldAdapt = this.shouldAdaptSubtitle(cueLang);
      const contextText = shouldAdapt ? this.enhancer?.getEnhanced(cue.id)?.line1_final?.trim() || cue.text : cue.text;
      const terms = keywordLists[i] ?? [];
      for (const rawTerm of terms) {
        const normalized = this.normalizeTerm(rawTerm);
        if (!normalized) continue;
        if (!termContexts.has(normalized)) {
          termContexts.set(normalized, contextText);
        }
      }
    }

    for (const [term, context] of termContexts.entries()) {
      this.queueExplanationPrefetch(term, context, token);
    }

    const prefetchElapsedMs = Math.round(performance.now() - prefetchStartedAt);
    if (prefetchElapsedMs >= SLOW_LOG_THRESHOLD_MS) {
      log.debug(`Prefetch keywords ready ms=${prefetchElapsedMs} terms=${termContexts.size}`);
    }
  }

  private queueBilingualPrefetch(cue: Cue, token: number): void {
    if (this.destroyed) return;
    if (token !== this.prefetchToken) return;
    if (this.isVideoPaused()) return;

    if (!cue.text || cue.text.trim().length < 2) return;
    if (this.bilingualPrefetchQueuedCueIds.has(cue.id)) return;

    const existing = this.enhancer?.getEnhanced(cue.id);
    if (existing && typeof existing.line2_final === 'string' && existing.line2_final.trim()) return;

    this.bilingualPrefetchQueuedCueIds.add(cue.id);
    this.bilingualPrefetchQueue.push(cue);
    this.pumpBilingualPrefetchQueue(token);
  }

  private pumpBilingualPrefetchQueue(token: number): void {
    if (this.destroyed) return;
    if (token !== this.prefetchToken) return;
    if (this.isVideoPaused()) return;

    if (
      this.bilingualPrefetchInFlight >= this.maxBilingualPrefetchInFlight &&
      this.bilingualPrefetchQueue.length > 0 &&
      Date.now() - this.debugLastBilingualPrefetchSaturationAt >= DEBUG_LOG_THROTTLE_MS
    ) {
      this.debugLastBilingualPrefetchSaturationAt = Date.now();
      log.debug(
        `Bilingual prefetch queue saturated inFlight=${this.bilingualPrefetchInFlight}/${this.maxBilingualPrefetchInFlight} queued=${this.bilingualPrefetchQueue.length}`
      );
    }

    while (this.bilingualPrefetchInFlight < this.maxBilingualPrefetchInFlight && this.bilingualPrefetchQueue.length > 0) {
      const next = this.bilingualPrefetchQueue.shift();
      if (!next) break;

      // Re-check in case we already filled it while it was queued.
      const existing = this.enhancer?.getEnhanced(next.id);
      if (existing && typeof existing.line2_final === 'string' && existing.line2_final.trim()) continue;

      this.bilingualPrefetchInFlight += 1;
      void (async () => {
        const enhancer = this.enhancer;
        if (!enhancer) return;
        if (this.destroyed || token !== this.prefetchToken) return;
        await enhancer.ensureBilingual(next);
      })()
        .catch((error: unknown) => {
          log.debug('Bilingual prefetch failed; ignoring', { cueId: next.id, message: getErrorMessage(error) });
        })
        .finally(() => {
          this.bilingualPrefetchInFlight -= 1;
          if (!this.destroyed && token === this.prefetchToken) {
            this.pumpBilingualPrefetchQueue(token);
          }
        });
    }
  }

  private queueExplanationPrefetch(term: string, context: string, token: number): void {
    if (this.destroyed) return;
    if (token !== this.prefetchToken) return;

    const normalized = this.normalizeTerm(term);
    if (!normalized) return;
    if (this.wordExplainCache.has(normalized)) return;
    if (this.wordExplainInFlight.has(normalized)) return;
    if (this.prefetchQueuedTerms.has(normalized)) return;

    this.prefetchQueuedTerms.add(normalized);
    this.prefetchQueue.push({ term: normalized, context });
    this.pumpPrefetchQueue(token);
  }

  private pumpPrefetchQueue(token: number): void {
    if (this.destroyed) return;
    if (token !== this.prefetchToken) return;
    if (this.isVideoPaused()) return;

    if (
      this.prefetchInFlight >= this.maxPrefetchInFlight &&
      this.prefetchQueue.length > 0 &&
      Date.now() - this.debugLastPrefetchSaturationAt >= DEBUG_LOG_THROTTLE_MS
    ) {
      this.debugLastPrefetchSaturationAt = Date.now();
      log.debug(
        `Prefetch queue saturated inFlight=${this.prefetchInFlight}/${this.maxPrefetchInFlight} queued=${this.prefetchQueue.length}`
      );
    }

    while (this.prefetchInFlight < this.maxPrefetchInFlight && this.prefetchQueue.length > 0) {
      const next = this.prefetchQueue.shift();
      if (!next) break;

      const term = next.term;
      const context = next.context;
      if (!term) continue;
      if (this.wordExplainCache.has(term)) continue;
      if (this.wordExplainInFlight.has(term)) continue;

      this.prefetchInFlight++;
      void this.getWordCardData(term, context)
        .catch((error: unknown) => {
          log.debug('Prefetch getWordCardData failed; ignoring', { term, message: getErrorMessage(error) });
        })
        .finally(() => {
          this.prefetchInFlight--;
          if (!this.destroyed && token === this.prefetchToken) {
            this.pumpPrefetchQueue(token);
          }
        });
    }
  }

  private async handleSubtitleWordClick(word: string, anchorRect: DOMRect): Promise<void> {
    await this.showWordExplanation(word, anchorRect, { pinned: true });
  }

  private async handleSubtitleWordHover(word: string, anchorRect: DOMRect): Promise<void> {
    await this.showWordExplanation(word, anchorRect, { pinned: false });
  }

  private async showWordExplanation(
    word: string,
    anchorRect: DOMRect,
    options: { pinned: boolean }
  ): Promise<void> {
    if (!this.overlay) return;
    if (!word.trim()) return;

    const normalized = this.normalizeTerm(word);
    if (normalized) {
      void sendMessage('REPORT_USAGE_EVENT', { event: 'word_card_opened', word: normalized, scene: 'subtitle' });
    }
    const cached = this.wordExplainCache.get(normalized);
    if (cached) {
      this.overlay.showWordCard(cached, anchorRect, options);
      return;
    }

    this.overlay.showWordCardLoading(normalized, anchorRect, options);

    const cueIndex = this.currentCueIndex;
    const contextWindow =
      cueIndex >= 0 ? this.buildCueContextWindow(cueIndex, this.currentSubtitleContext || normalized) : { before: [], after: [] };
    const card = await this.getWordCardData(normalized, this.currentSubtitleContext, contextWindow);
    this.wordExplainCache.set(normalized, card);
    this.overlay.showWordCard(card, anchorRect, options);
  }

  private async getWordCardData(
    normalizedWord: string,
    context?: string,
    contextWindow?: { before: string[]; after: string[] }
  ): Promise<WordCardData> {
    const cached = this.wordExplainCache.get(normalizedWord);
    if (cached) return cached;

    const inFlight = this.wordExplainInFlight.get(normalizedWord);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const startedAt = performance.now();
      const response = await sendMessage('EXPLAIN_WORD', {
        word: normalizedWord,
        ...(contextWindow && (contextWindow.before.length || contextWindow.after.length)
          ? { contextBefore: contextWindow.before, contextAfter: contextWindow.after }
          : (context && context.trim() ? { context: context.trim() } : {})),
      });
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (elapsedMs >= SLOW_LOG_THRESHOLD_MS) {
        log.debug(`EXPLAIN_WORD slow word=${normalizedWord} ms=${elapsedMs} ok=${response.ok}`);
      }

      if (!response.ok) {
        return {
          word: normalizedWord,
          definition: getI18nMessage('wordCard_definitionFailed'),
        };
      }

      const data = response.value as Record<string, unknown>;
      const definition =
        typeof data.definition === 'string' && data.definition.trim()
          ? data.definition.trim()
          : getI18nMessage('wordCard_definitionUnavailable');

      const card: WordCardData = {
        word: typeof data.word === 'string' && data.word.trim() ? data.word.trim() : normalizedWord,
        definition,
        ...(typeof data.phonetic === 'string' && data.phonetic.trim() ? { phonetic: data.phonetic.trim() } : {}),
        ...(typeof data.difficulty === 'string' && data.difficulty.trim() ? { difficulty: data.difficulty.trim() } : {}),
        ...(Array.isArray(data.targets) && data.targets.length > 0
          ? { targets: data.targets.filter((t): t is string => typeof t === 'string' && Boolean(t.trim())) }
          : {}),
        ...(typeof data.example === 'string' && data.example.trim() ? { example: data.example.trim() } : {}),
        ...(typeof data.example_translation === 'string' && data.example_translation.trim()
          ? { exampleTranslation: data.example_translation.trim() }
          : {}),
      };

      this.wordExplainCache.set(normalizedWord, card);
      return card;
    })().finally(() => {
      this.wordExplainInFlight.delete(normalizedWord);
    });

    this.wordExplainInFlight.set(normalizedWord, promise);
    return promise;
  }

  private computeInteractiveWords(texts: string[]): Set<string> {
    const minLength = (() => {
      switch (this.settings.proficiencyLevel) {
        case 'A1':
        case 'A2':
          return 3;
        case 'B1':
        case 'B2':
          return 4;
        case 'C1':
        case 'C2':
          return 5;
        default:
          return 4;
      }
    })();

    const maxWords = (() => {
      switch (this.settings.proficiencyLevel) {
        case 'A1':
          return 6;
        case 'A2':
          return 5;
        case 'B1':
          return 4;
        case 'B2':
          return 3;
        case 'C1':
        case 'C2':
          return 2;
        default:
          return 3;
      }
    })();

    const candidates = new Map<string, number>();
    const wordRegex = /[A-Za-z][A-Za-z'-]*/g;

    for (const text of texts) {
      wordRegex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = wordRegex.exec(text)) !== null) {
        const raw = match[0] ?? '';
        const normalized = raw.toLowerCase();
        if (normalized.length < minLength) continue;
        if (INTERACTIVE_WORD_STOPWORDS.has(normalized)) continue;
        const score = raw.length;
        candidates.set(normalized, Math.max(candidates.get(normalized) ?? 0, score));
      }
    }

    const selected = Array.from(candidates.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, maxWords)
      .map(([word]) => word);

    return new Set(selected);
  }

  /**
   * Setup keyboard listener for temporary bilingual mode
   */
  private setupKeyboardListener(): void {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    // Use 'c' key for temporary bilingual (can be configured later)
    if (event.key === 'c' && !this.tempBilingualKeyPressed) {
      this.tempBilingualKeyPressed = true;
      this.updateSubtitleDisplay();
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'c' && this.tempBilingualKeyPressed) {
      this.tempBilingualKeyPressed = false;
      this.updateSubtitleDisplay();
    }
  };

  toggleBilingualMode(): void {
    if (this.destroyed) return;
    this.mode = this.mode === 'enhanced' ? 'bilingual' : 'enhanced';
    this.updateSubtitleDisplay();
  }

  private handleVideoPause = (): void => {
    // Stop scheduling new background work while paused; let in-flight requests finish.
    this.prefetchToken++;
    this.prefetchQueue = [];
    this.prefetchQueuedTerms.clear();
  };

  private handleVideoPlay = (): void => {
    if (this.destroyed) return;
    // Resume background pipelines.
    this.enhancer?.pump();
    this.startPrefetchWindow();
    this.updateSubtitleDisplay();
  };
}

/**
 * Subtitle Controller
 *
 * Manages subtitle fetching, enhancement, and synchronization with video playback.
 * Supports YouTube and Bilibili platforms.
 */

import type { Cue, Settings, SupportedLanguage } from '@lexipath/core';
import { sendMessage } from '../shared/messages';
import { SubtitleOverlay, type SubtitleMode, type SubtitleLine, type WordCardData } from './subtitle-overlay';
import { createSubtitleProvider } from './subtitle-providers/create-subtitle-provider';
import type { SubtitleProvider } from './subtitle-providers/subtitle-provider';
import { getI18nMessage } from './i18n';
import { SubtitleVideoSync } from './subtitle-video-sync';
import { SubtitleEnhancer } from './subtitle-enhancer';

export { detectPlatform } from './subtitle-platform';
export type { Platform } from './subtitle-platform';

const SLOW_LOG_THRESHOLD_MS = 800;
const DEBUG_LOG_THROTTLE_MS = 1500;

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

  private readonly keywordPrefetchLookaheadMs = 15_000;
  private prefetchToken = 0;
  private prefetchQueue: Array<{ term: string; context: string }> = [];
  private prefetchQueuedTerms = new Set<string>();
  private prefetchInFlight = 0;
  private maxPrefetchInFlight = 5;
  private debugLastPrefetchSummaryAt = 0;
  private debugLastPrefetchSaturationAt = 0;

  private platformCaptionsEnabled: boolean | null = null;
  private platformCaptionsWatchToken = 0;
  private platformCaptionsObserver: MutationObserver | null = null;
  private platformCaptionsPollTimer: number | null = null;
  private platformCaptionsButton: HTMLElement | null = null;

  constructor(private settings: Settings) {}

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
      console.log('[SubtitleController] Unsupported platform or invalid URL');
      return false;
    }

    try {
      await this.provider.init(url, this.settings);
    } catch (error) {
      console.error('[SubtitleController] Provider init failed:', error);
      this.provider.destroy();
      this.provider = null;
      return false;
    }

    // Find video element
    this.videoElement = this.findVideoElement();
    if (!this.videoElement) {
      console.error('[SubtitleController] Video element not found');
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
      onCueEnhanced: (cueId) => {
        const currentCue = this.currentCueIndex >= 0 ? this.cues[this.currentCueIndex] : null;
        if (currentCue?.id === cueId) {
          this.updateSubtitleDisplay();
        }
      },
    });

    // Create overlay
    this.overlay = new SubtitleOverlay(this.provider.platform, {
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

    // Mount overlay
    const mounted = this.overlay.mount();
    if (!mounted) {
      console.error('[SubtitleController] Failed to mount overlay');
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

    // Fetch subtitles
    await this.fetchAndProcessSubtitles();

    // Start sync loop
    this.videoSync.start();

    // Setup keyboard listener for temporary bilingual mode
    this.setupKeyboardListener();

    // Enhance subtitles in background (do not block initial rendering)
    this.enhancer.start();

    console.log('[SubtitleController] Initialized successfully');
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
    this.stopPlatformCaptionsWatch();
    this.videoSync?.destroy();
    this.videoSync = null;
    this.enhancer?.destroy();
    this.enhancer = null;
    this.overlay?.unmount();
    this.overlay = null;
    this.provider?.destroy();
    this.provider = null;
    this.videoElement?.removeEventListener('play', this.handleVideoPlay);
    this.videoElement?.removeEventListener('pause', this.handleVideoPause);
    this.videoElement = null;
    this.cues = [];
    this.subtitleLanguage = '';
    this.cueKeywords.clear();
    this.cueKeywordSignatures.clear();
    this.cueKeywordsInFlight.clear();
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
    // when captions are off (or unknown), and wait for the user to enable them.
    if (provider.platform === 'bilibili' && this.platformCaptionsEnabled !== true) {
      return;
    }

    try {
      const result = await provider.fetchSubtitles();
      this.statusMessage = result.statusMessage ?? '';

      this.setCues(result.cues, result.lang);
      console.log(`[SubtitleController] Fetched ${result.cues.length} subtitle cues`);
    } catch (error) {
      console.error('[SubtitleController] Failed to fetch subtitles:', error);
    }
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

    if (cues.length > 0) {
      this.statusMessage = '';
      if (this.platformCaptionsEnabled !== false) {
        this.provider?.hideNativeCaptions?.();
      }
      this.videoSync?.syncOnce();
      this.enhancer?.start();
    } else {
      this.provider?.showNativeCaptions?.();
      this.renderStatusMessage();
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
      return;
    }

    if (this.cues.length === 0) {
      this.renderStatusMessage();
      return;
    }

    // Clear if no current cue
    if (this.currentCueIndex < 0 || this.currentCueIndex >= this.cues.length) {
      this.overlay.clear();
      return;
    }

    const cue = this.cues[this.currentCueIndex];
    if (!cue) {
      this.overlay.clear();
      return;
    }

    this.currentSubtitleContext = cue.text;
    const enhanced = this.enhancer?.getEnhanced(cue.id);
    const effectiveMode = this.tempBilingualKeyPressed ? 'bilingual-temp' : this.mode;

    let lines: SubtitleLine[] = [];

    if (effectiveMode === 'enhanced') {
      // Single line: enhanced only
      lines = [
        {
          text: enhanced?.line1_final || cue.text,
          isEnhanced: true,
        },
      ];
    } else {
      // Bilingual: enhanced + native translation (on-demand)
      const translation = typeof enhanced?.line2_final === 'string' ? enhanced.line2_final.trim() : '';
      if (!translation) {
        void this.enhancer?.ensureBilingual(cue);
      }

      const loadingTranslationText = getI18nMessage('subtitle_loadingTranslation');
      lines = [
        {
          text: enhanced?.line1_final || cue.text,
          isEnhanced: true,
        },
        {
          text: translation || loadingTranslationText,
          isEnhanced: false,
        },
      ];
    }

    const primaryText = lines[0]?.text ?? cue.text;
    void this.ensureCueKeywords(cue.id, primaryText);

    const signature = this.computeTextSignature(primaryText);
    const keywords = this.cueKeywordSignatures.get(cue.id) === signature ? this.cueKeywords.get(cue.id) : undefined;
    const interactiveWords =
      keywords && keywords.length > 0
        ? new Set(keywords.map((term) => this.normalizeTerm(term)))
        : this.computeInteractiveWords(lines.map((line) => line.text));
    this.overlay.display({ mode: effectiveMode, lines, interactiveWords });
  }

  private startPlatformCaptionsWatch(): void {
    this.stopPlatformCaptionsWatch();
    const token = ++this.platformCaptionsWatchToken;

    const poll = () => {
      if (this.destroyed) return;
      if (token !== this.platformCaptionsWatchToken) return;

      const button = this.findPlatformCaptionsButton();
      if (!button) {
        this.platformCaptionsPollTimer = window.setTimeout(poll, 1000);
        return;
      }

      this.platformCaptionsButton = button;
      this.platformCaptionsPollTimer = null;

      const update = () => {
        this.refreshPlatformCaptionsEnabled();
      };

      update();
      this.platformCaptionsObserver = new MutationObserver(update);
      this.platformCaptionsObserver.observe(button, {
        attributes: true,
        attributeFilter: ['aria-pressed', 'aria-checked', 'class'],
      });
    };

    poll();
  }

  private stopPlatformCaptionsWatch(): void {
    this.platformCaptionsWatchToken++;
    if (this.platformCaptionsPollTimer !== null) {
      window.clearTimeout(this.platformCaptionsPollTimer);
      this.platformCaptionsPollTimer = null;
    }
    if (this.platformCaptionsObserver) {
      this.platformCaptionsObserver.disconnect();
      this.platformCaptionsObserver = null;
    }
    this.platformCaptionsButton = null;
    this.platformCaptionsEnabled = null;
  }

  private findPlatformCaptionsButton(): HTMLElement | null {
    const provider = this.provider;
    if (!provider) return null;

    if (provider.platform === 'youtube') {
      const button = document.querySelector('.ytp-subtitles-button');
      return button instanceof HTMLElement ? button : null;
    }

    if (provider.platform === 'bilibili') {
      const selectors = [
        '.bpx-player-ctrl-subtitle',
        '.bpx-player-ctrl-btn.bpx-player-ctrl-subtitle',
        '.bilibili-player-video-btn-subtitle',
      ];

      for (const selector of selectors) {
        const button = document.querySelector(selector);
        if (button instanceof HTMLElement) return button;
      }
    }

    return null;
  }

  private getCaptionsEnabledFromButton(button: HTMLElement): boolean | null {
    const ariaPressed = button.getAttribute('aria-pressed');
    if (ariaPressed === 'true') return true;
    if (ariaPressed === 'false') return false;

    const ariaChecked = button.getAttribute('aria-checked');
    if (ariaChecked === 'true') return true;
    if (ariaChecked === 'false') return false;

    if (
      button.classList.contains('bpx-player-ctrl-btn-active') ||
      button.classList.contains('bilibili-player-video-btn-subtitle-on') ||
      button.classList.contains('active')
    ) {
      return true;
    }

    if (button.classList.contains('bilibili-player-video-btn-subtitle-off')) {
      return false;
    }

    // Bilibili's newer player buttons often represent the OFF state simply by not
    // having an "active" class/aria state. For Bilibili, fail-closed so the
    // extension doesn't render/fetch subtitles when the user has subtitles off.
    const isLikelyBilibiliButton =
      button.classList.contains('bpx-player-ctrl-subtitle') || button.classList.contains('bilibili-player-video-btn-subtitle');
    if (isLikelyBilibiliButton) return false;

    return null;
  }

  private refreshPlatformCaptionsEnabled(): void {
    const button = this.platformCaptionsButton;
    if (!button) return;

    const enabled = this.getCaptionsEnabledFromButton(button);
    if (enabled === null) return;
    if (this.platformCaptionsEnabled === enabled) return;

    this.platformCaptionsEnabled = enabled;
    if (!enabled) {
      this.provider?.showNativeCaptions?.();
    } else if (this.cues.length > 0) {
      this.provider?.hideNativeCaptions?.();
    } else {
      // Subtitles were previously gated by the platform caption toggle (notably Bilibili).
      // Once the user enables captions, fetch cues so the overlay can start working.
      void this.fetchAndProcessSubtitles();
    }

    this.updateSubtitleDisplay();
  }

  private async ensureCueBilingual(cue: Cue): Promise<void> {
    await this.enhancer?.ensureBilingual(cue);
    this.updateSubtitleDisplay();
  }

  private normalizeSupportedLanguageCode(languageCode: string): SupportedLanguage | null {
    const normalized = languageCode.trim().toLowerCase();
    if (!normalized) return null;

    const parts = normalized.split(/[-_]/).filter(Boolean);
    for (const part of parts) {
      switch (part) {
        case 'en':
        case 'ja':
        case 'ko':
        case 'fr':
        case 'de':
        case 'zh':
          return part;
        default:
          break;
      }
    }

    return null;
  }

  private getCueSourceLanguage(cue: Cue, subtitleLanguage: string): SupportedLanguage {
    const candidates = [subtitleLanguage, cue.lang, this.settings.targetLanguage];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const normalized = this.normalizeSupportedLanguageCode(candidate);
      if (normalized) return normalized;
    }
    return this.settings.targetLanguage;
  }

  private normalizeTerm(term: string): string {
    return term
      .replace(/\u2019/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  private computeTextSignature(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';

    let hash = 5381;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
      hash |= 0;
    }

    return `${normalized.length}:${hash >>> 0}`;
  }

  private ensureCueKeywords(cueId: string, text: string): Promise<string[]> {
    const trimmed = text.trim();
    if (!trimmed) return Promise.resolve([]);

    const signature = this.computeTextSignature(trimmed);
    if (this.cueKeywordSignatures.get(cueId) === signature && this.cueKeywords.has(cueId)) {
      return Promise.resolve(this.cueKeywords.get(cueId) ?? []);
    }

    const inFlightKey = `${cueId}:${signature}`;
    const inFlight = this.cueKeywordsInFlight.get(inFlightKey);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const startedAt = performance.now();
      const response = await sendMessage('SELECT_KEYWORDS', { text: trimmed, scene: 'subtitle' });
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (elapsedMs >= SLOW_LOG_THRESHOLD_MS) {
        console.debug(`[SubtitleController] SELECT_KEYWORDS slow cueId=${cueId} ms=${elapsedMs}`);
      }
      if (!response.ok) return [];
      return response.value;
    })()
      .then((keywords) => {
        this.cueKeywords.set(cueId, keywords);
        this.cueKeywordSignatures.set(cueId, signature);
        const currentCue = this.cues[this.currentCueIndex];
        if (currentCue?.id === cueId) {
          this.updateSubtitleDisplay();
        }
        return keywords;
      })
      .catch(() => {
        return [];
      })
      .finally(() => {
        this.cueKeywordsInFlight.delete(inFlightKey);
      });

    this.cueKeywordsInFlight.set(inFlightKey, promise);
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
      console.debug(
        `[SubtitleController] Prefetch window cues=${cuesInWindow.length} nowMs=${Math.round(nowMs)} lookaheadMs=${this.keywordPrefetchLookaheadMs}`
      );
    }

    const keywordLists = await Promise.all(cuesInWindow.map((cue) => this.ensureCueKeywords(cue.id, cue.text)));
    if (this.destroyed) return;
    if (token !== this.prefetchToken) {
      console.debug(
        `[SubtitleController] Prefetch aborted (token changed) cues=${cuesInWindow.length} waitedMs=${Math.round(performance.now() - prefetchStartedAt)}`
      );
      return;
    }

    const termContexts = new Map<string, string>();
    for (let i = 0; i < cuesInWindow.length; i++) {
      const cue = cuesInWindow[i];
      if (!cue) continue;
      const terms = keywordLists[i] ?? [];
      for (const rawTerm of terms) {
        const normalized = this.normalizeTerm(rawTerm);
        if (!normalized) continue;
        if (!termContexts.has(normalized)) {
          termContexts.set(normalized, cue.text);
        }
      }
    }

    for (const [term, context] of termContexts.entries()) {
      this.queueExplanationPrefetch(term, context, token);
    }

    const prefetchElapsedMs = Math.round(performance.now() - prefetchStartedAt);
    if (prefetchElapsedMs >= SLOW_LOG_THRESHOLD_MS) {
      console.debug(`[SubtitleController] Prefetch keywords ready ms=${prefetchElapsedMs} terms=${termContexts.size}`);
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
      console.debug(
        `[SubtitleController] Prefetch queue saturated inFlight=${this.prefetchInFlight}/${this.maxPrefetchInFlight} queued=${this.prefetchQueue.length}`
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
        .catch(() => {
          // ignore
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
    const cached = this.wordExplainCache.get(normalized);
    if (cached) {
      this.overlay.showWordCard(cached, anchorRect, options);
      return;
    }

    this.overlay.showWordCardLoading(normalized, anchorRect, options);

    const card = await this.getWordCardData(normalized, this.currentSubtitleContext);
    this.wordExplainCache.set(normalized, card);
    this.overlay.showWordCard(card, anchorRect, options);
  }

  private async getWordCardData(normalizedWord: string, context?: string): Promise<WordCardData> {
    const cached = this.wordExplainCache.get(normalizedWord);
    if (cached) return cached;

    const inFlight = this.wordExplainInFlight.get(normalizedWord);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const startedAt = performance.now();
      const response = await sendMessage('EXPLAIN_WORD', {
        word: normalizedWord,
        ...(context && context.trim() ? { context: context.trim() } : {}),
      });
      const elapsedMs = Math.round(performance.now() - startedAt);
      if (elapsedMs >= SLOW_LOG_THRESHOLD_MS) {
        console.debug(
          `[SubtitleController] EXPLAIN_WORD slow word=${normalizedWord} ms=${elapsedMs} ok=${response.ok}`
        );
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
        ...(typeof data.translation === 'string' && data.translation.trim() ? { translation: data.translation.trim() } : {}),
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
    const stopwords = new Set([
      'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
      'doing', 'for', 'from', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'him', 'his', 'how', 'i', 'if',
      'in', 'into', 'is', 'it', 'its', 'just', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'out', 'over',
      'she', 'so', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'too',
      'under', 'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with',
      'would', 'you', 'your',
    ]);

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
        if (stopwords.has(normalized)) continue;
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

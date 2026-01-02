/**
 * Subtitle Controller
 *
 * Manages subtitle fetching, enhancement, and synchronization with video playback.
 * Supports YouTube and Bilibili platforms.
 */

import type { Cue, Settings, SubtitleEnhanceOutput } from '@lexipath/core';
import browser from 'webextension-polyfill';
import {
  getVideoId as getYouTubeVideoId,
  fetchYouTubeSubtitles,
  parseVideoInfo as parseBilibiliVideoInfo,
  getCid,
  fetchBilibiliSubtitles,
  getBilibiliAvailableTracks,
} from '@lexipath/subtitles';
import { sendMessage } from '../shared/messages';
import { SubtitleOverlay, type SubtitleMode, type SubtitleLine, type WordCardData } from './subtitle-overlay';

export type Platform = 'youtube' | 'bilibili' | 'unknown';

export interface VideoInfo {
  platform: Platform;
  videoId: string;
  extraParams?: Record<string, string>;
}

/**
 * Detect current platform from URL
 */
export function detectPlatform(url: string): Platform {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    return 'youtube';
  }
  if (urlLower.includes('bilibili.com')) {
    return 'bilibili';
  }
  return 'unknown';
}

/**
 * Extract video information from URL
 */
export async function extractVideoInfo(url: string): Promise<VideoInfo | null> {
  const platform = detectPlatform(url);

  switch (platform) {
    case 'youtube': {
      const videoId = getYouTubeVideoId(url);
      if (!videoId) return null;
      return { platform, videoId };
    }

    case 'bilibili': {
      const info = parseBilibiliVideoInfo(url);
      if (!info) return null;

      let cid = info.cid;
      if (!cid) {
        try {
          cid = await getCid(info.bvid);
        } catch (error) {
          console.error('[SubtitleController] Failed to get cid:', error);
          return null;
        }
      }

      return {
        platform,
        videoId: info.bvid,
        extraParams: { cid },
      };
    }

    default:
      return null;
  }
}

/**
 * Subtitle Controller
 */
export class SubtitleController {
  private destroyed = false;
  private videoInfo: VideoInfo | null = null;
  private overlay: SubtitleOverlay | null = null;
  private cues: Cue[] = [];
  private enhancedCues: Map<string, SubtitleEnhanceOutput> = new Map();
  private currentCueIndex: number = -1;
  private videoElement: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private mode: SubtitleMode = 'enhanced';
  private tempBilingualKeyPressed: boolean = false;

  private enhanceQueueIndex = 0;
  private enhanceInFlight = 0;
  private enhancementStarted = false;
  private readonly maxEnhanceInFlight = 2;
  private enhancedCueCount = 0;

  private statusMessage = '';
  private youtubeAdditionalParams = '';
  private youtubeParamsWatchToken = 0;
  private cuesGeneration = 0;
  private subtitlesFetchPromise: Promise<void> | null = null;
  private runtimeMessageListenerAttached = false;
  private youtubeCaptionHideStyle: HTMLStyleElement | null = null;
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
  private readonly maxPrefetchInFlight = 20;

  constructor(private settings: Settings) {}

  private setYouTubeNativeCaptionsHidden(hidden: boolean): void {
    if (this.videoInfo?.platform !== 'youtube') return;
    const styleId = 'lexipath-hide-youtube-captions';

    if (!hidden) {
      if (this.youtubeCaptionHideStyle) {
        this.youtubeCaptionHideStyle.remove();
        this.youtubeCaptionHideStyle = null;
      } else {
        document.getElementById(styleId)?.remove();
      }
      return;
    }

    if (this.youtubeCaptionHideStyle && this.youtubeCaptionHideStyle.isConnected) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Hide YouTube's native captions when LexiPath overlay is available */
      .ytp-caption-window-container,
      .caption-window.ytp-caption-window-container,
      #movie_player .ytp-caption-window-container {
        display: none !important;
        visibility: hidden !important;
      }
    `;
    (document.documentElement || document.head || document.body).appendChild(style);
    this.youtubeCaptionHideStyle = style;
  }

  private ensureYouTubeCaptionsEnabled(): void {
    try {
      const button = document.querySelector('.ytp-subtitles-button');
      if (!(button instanceof HTMLElement)) return;
      const pressed = button.getAttribute('aria-pressed') === 'true';
      if (!pressed) button.click();
    } catch {
      // ignore
    }
  }

  private async tryGetYouTubeAdditionalParams(
    videoId: string,
    options?: { maxAttempts?: number; delayMs?: number }
  ): Promise<string> {
    if (this.youtubeAdditionalParams.trim()) return this.youtubeAdditionalParams;

    const maxAttempts = options?.maxAttempts ?? 6;
    const delayMs = options?.delayMs ?? 500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await browser.runtime.sendMessage({ type: 'GET_CAPTION_REQUEST_INFO', videoId });
        if (response && typeof response === 'object') {
          const record = response as Record<string, unknown>;
          if (record.success === true && typeof record.data === 'string' && record.data.trim()) {
            this.youtubeAdditionalParams = record.data;
            return record.data;
          }
        }
      } catch {
        // ignore
      }

      if (attempt === 0) {
        // Best-effort: try to trigger the player to request captions so background can intercept potc=...
        this.ensureYouTubeCaptionsEnabled();
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return '';
  }

  private attachRuntimeMessageListener(): void {
    if (this.runtimeMessageListenerAttached) return;
    this.runtimeMessageListenerAttached = true;
    browser.runtime.onMessage.addListener(this.handleRuntimeMessage);
  }

  private detachRuntimeMessageListener(): void {
    if (!this.runtimeMessageListenerAttached) return;
    this.runtimeMessageListenerAttached = false;
    browser.runtime.onMessage.removeListener(this.handleRuntimeMessage);
  }

  private handleRuntimeMessage = (message: unknown): void => {
    if (this.destroyed) return;
    if (!message || typeof message !== 'object') return;
    const record = message as Record<string, unknown>;
    if (record.type !== 'CAPTION_REQUEST_INTERCEPTED') return;

    const data = (record.data ?? null) as Record<string, unknown> | null;
    const videoId = typeof data?.videoId === 'string' ? data.videoId : '';
    const additionalParams = typeof data?.additionalParams === 'string' ? data.additionalParams : '';

    if (!videoId || !additionalParams) return;
    if (this.videoInfo?.platform !== 'youtube') return;
    if (this.videoInfo.videoId !== videoId) return;

    this.youtubeAdditionalParams = additionalParams;

    // If subtitles were missing initially, re-fetch now that we have the required params.
    if (this.cues.length === 0) {
      void this.fetchAndProcessSubtitles();
    }
  };

  /**
   * Initialize controller
   */
  async init(url: string): Promise<boolean> {
    // Detect platform and extract video info
    this.videoInfo = await extractVideoInfo(url);
    if (!this.videoInfo || this.videoInfo.platform === 'unknown') {
      console.log('[SubtitleController] Unsupported platform or invalid URL');
      return false;
    }

    console.log('[SubtitleController] Video info:', this.videoInfo);

    // Find video element
    this.videoElement = this.findVideoElement();
    if (!this.videoElement) {
      console.error('[SubtitleController] Video element not found');
      return false;
    }

    // Create overlay
    this.overlay = new SubtitleOverlay(this.videoInfo.platform, {
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
      return false;
    }

    // For YouTube, listen for background webRequest interception messages.
    this.attachRuntimeMessageListener();

    // Fetch subtitles
    await this.fetchAndProcessSubtitles();

    // Start sync loop
    this.startSync();

    // Setup keyboard listener for temporary bilingual mode
    this.setupKeyboardListener();

    // Enhance subtitles in background (do not block initial rendering)
    this.startSubtitleEnhancement();

    console.log('[SubtitleController] Initialized successfully');
    return true;
  }

  /**
   * Destroy controller and cleanup
   */
  destroy(): void {
    this.destroyed = true;
    this.youtubeParamsWatchToken++;
    this.prefetchToken++;
    this.prefetchQueue = [];
    this.prefetchQueuedTerms.clear();
    this.stopSync();
    this.overlay?.unmount();
    this.overlay = null;
    this.setYouTubeNativeCaptionsHidden(false);
    this.videoElement = null;
    this.cues = [];
    this.enhancedCues.clear();
    this.cueKeywords.clear();
    this.cueKeywordSignatures.clear();
    this.cueKeywordsInFlight.clear();
    this.currentCueIndex = -1;
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
    this.detachRuntimeMessageListener();
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
    if (!this.videoInfo) return;

    try {
      // Fetch subtitles based on platform
      let cues: Cue[] = [];

      if (this.videoInfo.platform === 'youtube') {
        // Fetch subtitles matching target language
        const videoId = this.videoInfo.videoId;
        const additionalParams = await this.tryGetYouTubeAdditionalParams(videoId, { maxAttempts: 6, delayMs: 500 });
        if (!additionalParams) {
          console.warn('[SubtitleController] No intercepted timedtext params; YouTube subtitles may be unavailable');
        }

        cues = await fetchYouTubeSubtitles(videoId, this.settings.targetLanguage, { additionalParams });

        if (cues.length === 0 && !additionalParams) {
          this.statusMessage = 'LexiPath: 请先在 YouTube 打开字幕 (CC)，我才能读取并增强字幕';
          this.renderStatusMessage();
          this.startYouTubeParamsWatch(videoId);
        } else {
          this.statusMessage = '';
        }
      } else if (this.videoInfo.platform === 'bilibili') {
        // Fetch subtitles for Bilibili
        const cid = this.videoInfo.extraParams?.cid;
        if (!cid) {
          console.error('[SubtitleController] Missing cid for Bilibili');
          return;
        }

        const tracks = await getBilibiliAvailableTracks(this.videoInfo.videoId, cid);
        if (tracks.length === 0) {
          console.log('[SubtitleController] No subtitle tracks found');
          return;
        }

        // Use first available track (or prefer target language if available)
        const desired = this.settings.targetLanguage.toLowerCase();
        const preferred =
          tracks.find((t) => t.languageCode.toLowerCase() === desired) ??
          tracks.find((t) => t.languageCode.toLowerCase().startsWith(`${desired}-`)) ??
          tracks.find((t) => t.languageCode.toLowerCase().includes(desired));
        const track = preferred || tracks[0];

        if (!track) return;
        cues = await fetchBilibiliSubtitles(track.url);
      }

      this.setCues(cues);
      console.log(`[SubtitleController] Fetched ${cues.length} subtitle cues`);
    } catch (error) {
      console.error('[SubtitleController] Failed to fetch subtitles:', error);
    }
  }

  private startYouTubeParamsWatch(videoId: string): void {
    const token = ++this.youtubeParamsWatchToken;
    void (async () => {
      const deadlineMs = Date.now() + 30_000;

      while (!this.destroyed && token === this.youtubeParamsWatchToken && Date.now() < deadlineMs) {
        if (this.youtubeAdditionalParams.trim()) break;
        const params = await this.tryGetYouTubeAdditionalParams(videoId, { maxAttempts: 1, delayMs: 0 });
        if (params.trim()) break;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (this.destroyed || token !== this.youtubeParamsWatchToken) return;
      if (!this.youtubeAdditionalParams.trim()) return;
      if (this.videoInfo?.platform !== 'youtube' || this.videoInfo.videoId !== videoId) return;

      if (this.cues.length === 0) {
        void this.fetchAndProcessSubtitles();
      }
    })();
  }

  private setCues(cues: Cue[]): void {
    this.cuesGeneration++;
    this.cues = cues;
    this.currentCueIndex = -1;
    this.enhancedCues.clear();
    this.cueKeywords.clear();
    this.cueKeywordSignatures.clear();
    this.cueKeywordsInFlight.clear();
    this.enhancedCueCount = 0;
    this.enhanceQueueIndex = 0;

    if (cues.length > 0) {
      this.statusMessage = '';
      // We already fetched captions successfully; prefer LexiPath overlay and hide native captions.
      this.setYouTubeNativeCaptionsHidden(this.videoInfo?.platform === 'youtube');
      this.syncSubtitle();
    } else {
      this.renderStatusMessage();
    }

    // Kick (or resume) enhancement now that cues are available.
    if (!this.enhancementStarted) {
      this.startSubtitleEnhancement();
    } else {
      this.pumpSubtitleEnhancement();
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
   * Enhance subtitles incrementally with concurrency limit.
   */
  private startSubtitleEnhancement(): void {
    if (this.enhancementStarted) return;
    this.enhancementStarted = true;
    this.enhanceQueueIndex = 0;
    this.enhanceInFlight = 0;
    this.pumpSubtitleEnhancement();
  }

  private pumpSubtitleEnhancement(): void {
    if (this.destroyed) return;
    if (this.cues.length === 0) return;

    while (this.enhanceInFlight < this.maxEnhanceInFlight && this.enhanceQueueIndex < this.cues.length) {
      const cue = this.cues[this.enhanceQueueIndex++];
      if (!cue) continue;
      if (this.enhancedCues.has(cue.id)) continue;
      if (!cue.text || cue.text.trim().length < 2) continue;

      this.enhanceInFlight++;
      const generation = this.cuesGeneration;
      void this.enhanceCue(cue, generation)
        .catch(() => {
          // enhanceCue already logs; keep pipeline moving
        })
        .finally(() => {
          this.enhanceInFlight--;
          this.pumpSubtitleEnhancement();
        });
    }
  }

  private async enhanceCue(cue: Cue, generation: number): Promise<void> {
    const startMs = performance.now();
    try {
      const response = await sendMessage('ENHANCE_SUBTITLE', {
        subtitle: cue.text,
        sourceLang: this.settings.targetLanguage,
        mode: 'single',
      });

      if (!response.ok) {
        console.warn(`[SubtitleController] Failed to enhance cue ${cue.id}:`, response.error);
        return;
      }

      if (this.destroyed || generation !== this.cuesGeneration) return;

      const enhanced = response.value;
      if (!enhanced.line1_final || !enhanced.line1_final.trim()) return;

      this.enhancedCues.set(cue.id, enhanced);
      this.enhancedCueCount++;

      const currentCue = this.currentCueIndex >= 0 ? this.cues[this.currentCueIndex] : null;
      if (currentCue?.id === cue.id) {
        this.updateSubtitleDisplay();
      }
    } finally {
      const elapsedMs = Math.round(performance.now() - startMs);
      if (elapsedMs >= 800 || this.enhancedCueCount % 20 === 0) {
        console.log(`[SubtitleController] Enhanced ${this.enhancedCueCount}/${this.cues.length} cues (lastMs=${elapsedMs})`);
      }
    }
  }

  /**
   * Find video element on page
   */
  private findVideoElement(): HTMLVideoElement | null {
    const video = document.querySelector('video');
    return video instanceof HTMLVideoElement ? video : null;
  }

  /**
   * Start synchronization loop
   */
  private startSync(): void {
    if (this.rafId !== null) return;

    const syncLoop = () => {
      this.syncSubtitle();
      this.rafId = requestAnimationFrame(syncLoop);
    };

    this.rafId = requestAnimationFrame(syncLoop);
  }

  /**
   * Stop synchronization loop
   */
  private stopSync(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Synchronize subtitle with video time
   */
  private syncSubtitle(): void {
    if (!this.videoElement || this.cues.length === 0) return;

    const currentTimeMs = this.videoElement.currentTime * 1000;

    // Find current cue
    const cueIndex = this.cues.findIndex(
      (cue) => currentTimeMs >= cue.startMs && currentTimeMs < cue.endMs
    );

    // Update if cue changed
    if (cueIndex !== this.currentCueIndex) {
      this.currentCueIndex = cueIndex;
      this.updateSubtitleDisplay();
      this.startPrefetchWindow();
    }
  }

  /**
   * Update subtitle display based on current cue and mode
   */
  private updateSubtitleDisplay(): void {
    if (!this.overlay) return;

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
    const enhanced = this.enhancedCues.get(cue.id);
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
      // Bilingual: enhanced + original
      lines = [
        {
          text: enhanced?.line1_final || cue.text,
          isEnhanced: true,
        },
        {
          text: cue.text,
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
      const response = await sendMessage('SELECT_KEYWORDS', { text: trimmed, scene: 'subtitle' });
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

    const token = ++this.prefetchToken;
    this.prefetchQueue = [];
    this.prefetchQueuedTerms.clear();

    void this.prefetchAhead(token);
  }

  private async prefetchAhead(token: number): Promise<void> {
    if (!this.videoElement) return;
    if (this.destroyed) return;
    if (token !== this.prefetchToken) return;

    const nowMs = this.videoElement.currentTime * 1000;
    const windowEndMs = nowMs + this.keywordPrefetchLookaheadMs;

    const cuesInWindow: Cue[] = [];
    for (let i = Math.max(0, this.currentCueIndex); i < this.cues.length; i++) {
      const cue = this.cues[i];
      if (!cue) continue;
      if (cue.startMs >= windowEndMs) break;
      if (cue.endMs <= nowMs) continue;
      cuesInWindow.push(cue);
    }

    const keywordLists = await Promise.all(cuesInWindow.map((cue) => this.ensureCueKeywords(cue.id, cue.text)));
    if (this.destroyed) return;
    if (token !== this.prefetchToken) return;

    const termContexts = new Map<string, string>();
    for (let i = 0; i < cuesInWindow.length; i++) {
      const cue = cuesInWindow[i];
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
      const response = await sendMessage('EXPLAIN_WORD', {
        word: normalizedWord,
        ...(context && context.trim() ? { context: context.trim() } : {}),
      });

      if (!response.ok) {
        return {
          word: normalizedWord,
          definition: 'Failed to load definition',
        };
      }

      const data = response.value as Record<string, unknown>;
      const definition =
        typeof data.definition === 'string' && data.definition.trim()
          ? data.definition.trim()
          : 'No definition available';

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
}

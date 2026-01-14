import type { Cue, Settings } from '@lexipath/core';
import browser from 'webextension-polyfill';
import { createLogger, getErrorMessage } from '@lexipath/core/log';
import { fetchYouTubeSubtitles, getVideoId as getYouTubeVideoId, SubtitleHttpError } from '@lexipath/subtitles';
import type { SubtitleFetchResult, SubtitleProvider } from './subtitle-provider';
import { getI18nMessage } from '../../i18n';

const CAPTIONS_KICK_DEBOUNCE_MS = 1500;
const ADDITIONAL_PARAMS_POLL_DELAY_MS = 500;
const ADDITIONAL_PARAMS_POLL_MAX_ATTEMPTS = 6;
const ADDITIONAL_PARAMS_WATCH_DEADLINE_MS = 30_000;
const ADDITIONAL_PARAMS_WATCH_INTERVAL_MS = 1000;
const LIVE_POLL_INTERVAL_MS = 2000;
const log = createLogger('subtitle-provider:youtube');

function detectYouTubeRoute(url: string): { isShorts: boolean; isLive: boolean } {
  const raw = url.trim();
  if (!raw) return { isShorts: false, isLive: false };
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname.toLowerCase();
    return {
      isShorts: pathname.startsWith('/shorts/'),
      isLive: pathname.startsWith('/live/'),
    };
  } catch (error: unknown) {
    log.debug('detectYouTubeRoute URL parse failed; falling back to substring checks', { message: getErrorMessage(error) });
    // If URL isn't absolute, fall back to substring checks.
    const lower = raw.toLowerCase();
    return {
      isShorts: lower.includes('/shorts/'),
      isLive: lower.includes('/live/'),
    };
  }
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export class YouTubeSubtitleProvider implements SubtitleProvider {
  readonly platform = 'youtube' as const;

  private destroyed = false;
  private settings: Settings | null = null;
  private videoId: string | null = null;

  private isShorts = false;
  private isLive = false;
  private livePollTimer: number | null = null;
  private liveCues: Cue[] = [];
  private liveCueKeys = new Set<string>();
  private liveLastEndMs = 0;

  private youtubeAdditionalParams = '';
  private youtubeParamsWatchToken = 0;
  private lastYouTubeCaptionsKickAt = 0;
  private runtimeMessageListenerAttached = false;
  private youtubeCaptionHideStyle: HTMLStyleElement | null = null;

  private readonly onSubtitlesMayBeAvailable: (() => void) | undefined;

  constructor(options: { onSubtitlesMayBeAvailable?: () => void } = {}) {
    this.onSubtitlesMayBeAvailable = options.onSubtitlesMayBeAvailable;
  }

  async init(url: string, settings: Settings): Promise<void> {
    const videoId = getYouTubeVideoId(url);
    if (!videoId) {
      throw new Error('[YouTubeSubtitleProvider] Invalid YouTube URL');
    }

    const route = detectYouTubeRoute(url);
    this.isShorts = route.isShorts;
    this.isLive = route.isLive;

    this.settings = settings;
    this.videoId = videoId;

    this.attachRuntimeMessageListener();

    if (this.isLive) {
      this.startLivePolling();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.youtubeParamsWatchToken++;
    this.stopLivePolling();
    this.detachRuntimeMessageListener();
    this.showNativeCaptions?.();

    this.settings = null;
    this.videoId = null;
    this.isShorts = false;
    this.isLive = false;
    this.liveCues = [];
    this.liveCueKeys.clear();
    this.liveLastEndMs = 0;
  }

  hideNativeCaptions(): void {
    if (this.destroyed) return;
    const styleId = 'lexipath-hide-youtube-captions';

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

  showNativeCaptions(): void {
    const styleId = 'lexipath-hide-youtube-captions';

    if (this.youtubeCaptionHideStyle) {
      this.youtubeCaptionHideStyle.remove();
      this.youtubeCaptionHideStyle = null;
    } else {
      document.getElementById(styleId)?.remove();
    }
  }

  async fetchSubtitles(): Promise<SubtitleFetchResult> {
    if (!this.settings || !this.videoId) return { cues: [] };

    const videoId = this.videoId;
    const additionalParams = await this.tryGetYouTubeAdditionalParams(videoId, {
      maxAttempts: ADDITIONAL_PARAMS_POLL_MAX_ATTEMPTS,
      delayMs: ADDITIONAL_PARAMS_POLL_DELAY_MS,
      forceRefreshIfAlreadyEnabled: true,
    });

    if (!additionalParams) {
      log.warn('No intercepted timedtext params; YouTube subtitles may be unavailable');
    }

    try {
      const cues = await fetchYouTubeSubtitles(videoId, this.settings.targetLanguage, {
        additionalParams,
        ...(this.isLive ? { live: true } : {}),
      });

      if (this.isLive) {
        const merged = this.mergeLiveCues(cues, { videoId });
        if (merged.length === 0) {
          return {
            cues: [],
            lang: this.settings.targetLanguage,
            statusMessage: getI18nMessage('subtitle_liveWaiting'),
          };
        }
        return { cues: merged, lang: merged[0]?.lang ?? this.settings.targetLanguage };
      }

      if (cues.length === 0 && !additionalParams) {
        this.startYouTubeParamsWatch(videoId);
        return {
          cues,
          lang: this.settings.targetLanguage,
          statusMessage: getI18nMessage('subtitle_youtubeEnableCaptions'),
        };
      }

      return { cues, lang: cues[0]?.lang ?? this.settings.targetLanguage };
    } catch (error) {
      if (error instanceof SubtitleHttpError && (error.status === 401 || error.status === 403)) {
        return {
          cues: [],
          lang: this.settings.targetLanguage,
          statusMessage: getI18nMessage('subtitle_requiresPremium'),
        };
      }
      throw error;
    }
  }

  private kickYouTubeCaptionsRequest(options?: { forceRefreshIfAlreadyEnabled?: boolean }): void {
    try {
      const now = Date.now();
      if (now - this.lastYouTubeCaptionsKickAt < CAPTIONS_KICK_DEBOUNCE_MS) return;

      const button = this.findYouTubeCaptionsButton();
      if (!(button instanceof HTMLElement)) return;
      const pressed = button.getAttribute('aria-pressed') === 'true';
      const forceRefreshIfAlreadyEnabled = options?.forceRefreshIfAlreadyEnabled ?? false;

      if (!pressed) {
        button.click();
        this.lastYouTubeCaptionsKickAt = now;
        return;
      }

      if (forceRefreshIfAlreadyEnabled) {
        button.click();
        button.click();
        this.lastYouTubeCaptionsKickAt = now;
      }
    } catch (error: unknown) {
      log.debug('kickYouTubeCaptionsRequest failed; ignoring', { message: getErrorMessage(error) });
    }
  }

  private findYouTubeCaptionsButton(): HTMLElement | null {
    const selectors = [
      '.ytp-subtitles-button',
      // Shorts often renders a different button surface with aria labels.
      'ytd-reel-player-overlay-renderer button[aria-label*="字幕"]',
      'ytd-reel-player-overlay-renderer button[aria-label*="Subtitles"]',
      'button[aria-label*="字幕"]',
      'button[aria-label*="Subtitles"]',
      'button[aria-label*="captions"]',
      'button[aria-label*="Captions"]',
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el instanceof HTMLElement) return el;
    }
    return null;
  }

  private async tryGetYouTubeAdditionalParams(
    videoId: string,
    options?: { maxAttempts?: number; delayMs?: number; forceRefreshIfAlreadyEnabled?: boolean }
  ): Promise<string> {
    if (this.youtubeAdditionalParams.trim()) return this.youtubeAdditionalParams;
    if (this.destroyed) return '';

    const maxAttempts = options?.maxAttempts ?? 1;
    const delayMs = options?.delayMs ?? 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.destroyed) return '';
      try {
        const response = await browser.runtime.sendMessage({ type: 'GET_CAPTION_REQUEST_INFO', videoId });
        if (response && typeof response === 'object') {
          const record = response as Record<string, unknown>;
          if (record.success === true && typeof record.data === 'string' && record.data.trim()) {
            this.youtubeAdditionalParams = record.data;
            return record.data;
          }
        }
      } catch (error: unknown) {
        log.debug('GET_CAPTION_REQUEST_INFO sendMessage failed; ignoring', { attempt, message: getErrorMessage(error) });
      }

      if (attempt === 0) {
        this.kickYouTubeCaptionsRequest({
          forceRefreshIfAlreadyEnabled: options?.forceRefreshIfAlreadyEnabled ?? false,
        });
      }

      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
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
    if (!this.videoId || this.videoId !== videoId) return;

    this.youtubeAdditionalParams = additionalParams;
    this.onSubtitlesMayBeAvailable?.();
  };

  private startYouTubeParamsWatch(videoId: string): void {
    const token = ++this.youtubeParamsWatchToken;
    void (async () => {
      const deadlineMs = Date.now() + ADDITIONAL_PARAMS_WATCH_DEADLINE_MS;

      while (!this.destroyed && token === this.youtubeParamsWatchToken && Date.now() < deadlineMs) {
        if (this.youtubeAdditionalParams.trim()) break;
        const params = await this.tryGetYouTubeAdditionalParams(videoId, { maxAttempts: 1, delayMs: 0 });
        if (params.trim()) break;
        await new Promise((resolve) => setTimeout(resolve, ADDITIONAL_PARAMS_WATCH_INTERVAL_MS));
      }

      if (this.destroyed || token !== this.youtubeParamsWatchToken) return;
      if (!this.youtubeAdditionalParams.trim()) return;
      if (!this.videoId || this.videoId !== videoId) return;

      this.onSubtitlesMayBeAvailable?.();
    })();
  }

  private startLivePolling(): void {
    if (this.livePollTimer !== null) return;

    const tick = () => {
      if (this.destroyed) return;
      this.onSubtitlesMayBeAvailable?.();
      this.livePollTimer = window.setTimeout(tick, LIVE_POLL_INTERVAL_MS);
    };

    this.livePollTimer = window.setTimeout(tick, LIVE_POLL_INTERVAL_MS);
  }

  private stopLivePolling(): void {
    if (this.livePollTimer === null) return;
    window.clearTimeout(this.livePollTimer);
    this.livePollTimer = null;
  }

  private mergeLiveCues(cues: Cue[], options: { videoId: string }): Cue[] {
    for (const cue of cues) {
      if (!cue || !Number.isFinite(cue.startMs) || !Number.isFinite(cue.endMs)) continue;
      if (cue.endMs <= cue.startMs) continue;
      if (!cue.text || !cue.text.trim()) continue;

      // Avoid unbounded growth due to overlapping polling windows.
      if (cue.endMs <= this.liveLastEndMs - 2500) continue;

      const key = `${cue.startMs}-${cue.endMs}-${cue.text.trim()}`;
      if (this.liveCueKeys.has(key)) continue;
      this.liveCueKeys.add(key);

      const stableId = `youtube-live:${options.videoId}:${cue.startMs}-${cue.endMs}:${hashString(key)}`;
      this.liveCues.push({ ...cue, id: stableId, source: 'youtube' });
      this.liveLastEndMs = Math.max(this.liveLastEndMs, cue.endMs);
    }

    this.liveCues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

    // Trim old cues to cap memory for long livestreams (~30 minutes).
    const cutoffMs = this.liveLastEndMs - 30 * 60 * 1000;
    if (cutoffMs > 0) {
      const keep = this.liveCues.filter((cue) => cue.endMs >= cutoffMs);
      if (keep.length !== this.liveCues.length) {
        this.liveCues = keep;
        this.liveCueKeys = new Set(this.liveCues.map((cue) => `${cue.startMs}-${cue.endMs}-${cue.text.trim()}`));
      }
    }

    return this.liveCues;
  }
}

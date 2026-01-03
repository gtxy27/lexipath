import type { Cue, Settings } from '@lexipath/core';
import browser from 'webextension-polyfill';
import { fetchYouTubeSubtitles, getVideoId as getYouTubeVideoId } from '@lexipath/subtitles';
import type { SubtitleFetchResult, SubtitleProvider } from './subtitle-provider';
import { getI18nMessage } from '../i18n';

const CAPTIONS_KICK_DEBOUNCE_MS = 1500;
const ADDITIONAL_PARAMS_POLL_DELAY_MS = 500;
const ADDITIONAL_PARAMS_POLL_MAX_ATTEMPTS = 6;
const ADDITIONAL_PARAMS_WATCH_DEADLINE_MS = 30_000;
const ADDITIONAL_PARAMS_WATCH_INTERVAL_MS = 1000;

export class YouTubeSubtitleProvider implements SubtitleProvider {
  readonly platform = 'youtube' as const;

  private destroyed = false;
  private settings: Settings | null = null;
  private videoId: string | null = null;

  private youtubeAdditionalParams = '';
  private youtubeParamsWatchToken = 0;
  private lastYouTubeCaptionsKickAt = 0;
  private runtimeMessageListenerAttached = false;
  private youtubeCaptionHideStyle: HTMLStyleElement | null = null;

  private readonly onSubtitlesMayBeAvailable?: () => void;

  constructor(options: { onSubtitlesMayBeAvailable?: () => void } = {}) {
    this.onSubtitlesMayBeAvailable = options.onSubtitlesMayBeAvailable;
  }

  async init(url: string, settings: Settings): Promise<void> {
    const videoId = getYouTubeVideoId(url);
    if (!videoId) {
      throw new Error('[YouTubeSubtitleProvider] Invalid YouTube URL');
    }

    this.settings = settings;
    this.videoId = videoId;

    this.attachRuntimeMessageListener();
  }

  destroy(): void {
    this.destroyed = true;
    this.youtubeParamsWatchToken++;
    this.detachRuntimeMessageListener();
    this.showNativeCaptions?.();

    this.settings = null;
    this.videoId = null;
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
      console.warn('[YouTubeSubtitleProvider] No intercepted timedtext params; YouTube subtitles may be unavailable');
    }

    const cues = await fetchYouTubeSubtitles(videoId, this.settings.targetLanguage, { additionalParams });

    if (cues.length === 0 && !additionalParams) {
      this.startYouTubeParamsWatch(videoId);
      return {
        cues,
        statusMessage: getI18nMessage(
          'subtitle_youtubeEnableCaptions',
          undefined,
          'LexiPath: Please enable YouTube captions (CC) so I can read and enhance subtitles'
        ),
      };
    }

    return { cues };
  }

  private kickYouTubeCaptionsRequest(options?: { forceRefreshIfAlreadyEnabled?: boolean }): void {
    try {
      const now = Date.now();
      if (now - this.lastYouTubeCaptionsKickAt < CAPTIONS_KICK_DEBOUNCE_MS) return;

      const button = document.querySelector('.ytp-subtitles-button');
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
    } catch {
      // ignore
    }
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
      } catch {
        // ignore
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
}

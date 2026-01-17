import type { Cue, Settings } from '@lexipath/core';
import { createLogger } from '@lexipath/core/log';
import { parseVideoInfo, SubtitleHttpError } from '@lexipath/subtitles';
import { sendMessage } from '../../../shared/messages';
import type { SubtitleFetchResult, SubtitleProvider } from './subtitle-provider';
import { getI18nMessage } from '../../i18n';

const log = createLogger('subtitle-provider:bilibili');

function isBilibiliAuthLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message || '';
  // Common unauthenticated / VIP gating codes and phrases.
  return msg.includes('code -101') || msg.includes('code -10403') || msg.toLowerCase().includes('login');
}

export class BilibiliSubtitleProvider implements SubtitleProvider {
  readonly platform = 'bilibili' as const;

  private settings: Settings | null = null;
  private bvid: string | null = null;
  private cid: string | null = null;
  private bilibiliCaptionHideStyle: HTMLStyleElement | null = null;

  async init(url: string, settings: Settings): Promise<void> {
    const info = parseVideoInfo(url);
    if (!info) {
      throw new Error('[BilibiliSubtitleProvider] Invalid Bilibili URL');
    }

    this.settings = settings;
    this.bvid = info.bvid;
    // cid can be fetched in background when needed.
    this.cid = info.cid ?? null;
  }

  destroy(): void {
    this.showNativeCaptions();
    this.settings = null;
    this.bvid = null;
    this.cid = null;
  }

  hideNativeCaptions(): void {
    const styleId = 'lexipath-hide-bilibili-captions';

    if (this.bilibiliCaptionHideStyle && this.bilibiliCaptionHideStyle.isConnected) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      /* Hide Bilibili's native captions when LexiPath overlay is available */
      .bpx-player-subtitle-wrap,
      .bilibili-player-video-subtitle,
      .bpx-player-subtitle-panel-text {
        display: none !important;
        visibility: hidden !important;
      }
    `;
    (document.documentElement || document.head || document.body).appendChild(style);
    this.bilibiliCaptionHideStyle = style;
  }

  showNativeCaptions(): void {
    const styleId = 'lexipath-hide-bilibili-captions';

    if (this.bilibiliCaptionHideStyle) {
      this.bilibiliCaptionHideStyle.remove();
      this.bilibiliCaptionHideStyle = null;
    } else {
      document.getElementById(styleId)?.remove();
    }
  }

  async fetchSubtitles(): Promise<SubtitleFetchResult> {
    if (!this.settings || !this.bvid) return { cues: [] };

    try {
      const response = await sendMessage('FETCH_SUBTITLES', {
        platform: 'bilibili',
        url: `https://www.bilibili.com/video/${encodeURIComponent(this.bvid)}`,
        targetLanguage: this.settings.targetLanguage,
      });

      if (!response.ok) {
        throw new Error(response.error.message);
      }

      const cues = response.value.cues as Cue[];
      const lang = typeof response.value.lang === 'string' ? response.value.lang : undefined;
      const statusMessage =
        typeof response.value.statusMessage === 'string' && response.value.statusMessage.trim()
          ? response.value.statusMessage
          : undefined;

      if (lang && statusMessage) return { cues, lang, statusMessage };
      if (lang) return { cues, lang };
      if (statusMessage) return { cues, statusMessage };
      return { cues };
    } catch (error) {
      if (error instanceof SubtitleHttpError && (error.status === 401 || error.status === 403)) {
        return { cues: [], statusMessage: getI18nMessage('subtitle_requiresVip') };
      }
      if (isBilibiliAuthLikeError(error)) {
        return { cues: [], statusMessage: getI18nMessage('subtitle_requiresVip') };
      }
      throw error;
    }
  }
}

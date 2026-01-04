import type { Settings } from '@lexipath/core';
import { fetchBilibiliSubtitles, getBilibiliAvailableTracks, getCid, parseVideoInfo } from '@lexipath/subtitles';
import type { SubtitleFetchResult, SubtitleProvider } from './subtitle-provider';

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
    this.cid = info.cid ?? (await getCid(info.bvid, info.pageNumber));
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
    if (!this.settings || !this.bvid || !this.cid) return { cues: [] };

    const tracks = await getBilibiliAvailableTracks(this.bvid, this.cid);
    if (tracks.length === 0) {
      console.log('[BilibiliSubtitleProvider] No subtitle tracks found');
      return { cues: [] };
    }

    const desired = this.settings.targetLanguage.toLowerCase();
    const preferred =
      tracks.find((track) => track.languageCode.toLowerCase() === desired) ??
      tracks.find((track) => track.languageCode.toLowerCase().startsWith(`${desired}-`)) ??
      tracks.find((track) => track.languageCode.toLowerCase().includes(desired));
    const track = preferred || tracks[0];

    if (!track) return { cues: [] };
    const cues = await fetchBilibiliSubtitles(track.url);
    return { cues, lang: track.languageCode };
  }
}

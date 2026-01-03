import type { Settings } from '@lexipath/core';
import { fetchBilibiliSubtitles, getBilibiliAvailableTracks, getCid, parseVideoInfo } from '@lexipath/subtitles';
import type { SubtitleFetchResult, SubtitleProvider } from './subtitle-provider';

export class BilibiliSubtitleProvider implements SubtitleProvider {
  readonly platform = 'bilibili' as const;

  private settings: Settings | null = null;
  private bvid: string | null = null;
  private cid: string | null = null;

  async init(url: string, settings: Settings): Promise<void> {
    const info = parseVideoInfo(url);
    if (!info) {
      throw new Error('[BilibiliSubtitleProvider] Invalid Bilibili URL');
    }

    this.settings = settings;
    this.bvid = info.bvid;
    this.cid = info.cid ?? (await getCid(info.bvid));
  }

  destroy(): void {
    this.settings = null;
    this.bvid = null;
    this.cid = null;
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
    return { cues };
  }
}


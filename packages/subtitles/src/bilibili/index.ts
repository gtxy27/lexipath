/**
 * Bilibili subtitle adapter.
 * Fetches and normalizes Bilibili subtitles to Cue format.
 */

import type { Cue } from '@lexipath/core';

export interface BilibiliSubtitleTrack {
  languageCode: string;
  name: string;
  url: string;
}

export class BilibiliAdapter {
  /**
   * Get available subtitle tracks for a video.
   */
  async getAvailableTracks(_bvid: string, _cid: string): Promise<BilibiliSubtitleTrack[]> {
    // TODO: Implement subtitle track discovery
    return [];
  }

  /**
   * Fetch subtitles from a track URL.
   */
  async fetchSubtitles(_url: string): Promise<Cue[]> {
    // TODO: Implement subtitle fetching
    return [];
  }
}

/**
 * @lexipath/subtitles
 *
 * Subtitle adapters for YouTube and Bilibili.
 * Encapsulates platform differences, outputs unified Cue model.
 */

export type { Cue, CueSource } from '@lexipath/core';

// Generic subtitle parsers (string -> Cue[])
export { parseSrt, parseTtml, parseWebVtt } from './parsers';

// YouTube
export {
  YouTubeAdapter,
  getVideoId,
  fetchSubtitles as fetchYouTubeSubtitles,
  getAvailableTracks as getYouTubeAvailableTracks,
  type YouTubeSubtitleTrack,
} from './youtube';

// Bilibili
export {
  BilibiliAdapter,
  parseVideoInfo,
  getCid,
  fetchSubtitles as fetchBilibiliSubtitles,
  getAvailableTracks as getBilibiliAvailableTracks,
  type BilibiliSubtitleTrack,
} from './bilibili';

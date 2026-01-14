import type { Cue, Settings } from '@lexipath/core';
import type { SupportedPlatform } from '../subtitle-platform';

export type SubtitleFetchResult = {
  cues: Cue[];
  statusMessage?: string;
  lang?: string;
};

export interface SubtitleProvider {
  readonly platform: SupportedPlatform;

  init(url: string, settings: Settings): Promise<void>;
  fetchSubtitles(): Promise<SubtitleFetchResult>;

  hideNativeCaptions?(): void;
  showNativeCaptions?(): void;
  destroy(): void;
}

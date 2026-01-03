import { detectPlatform } from '../subtitle-platform';
import type { SubtitleProvider } from './subtitle-provider';
import { BilibiliSubtitleProvider } from './bilibili-subtitle-provider';
import { YouTubeSubtitleProvider } from './youtube-subtitle-provider';

export function createSubtitleProvider(
  url: string,
  options: { onSubtitlesMayBeAvailable?: () => void } = {}
): SubtitleProvider | null {
  const platform = detectPlatform(url);
  if (platform === 'youtube') {
    return new YouTubeSubtitleProvider({ onSubtitlesMayBeAvailable: options.onSubtitlesMayBeAvailable });
  }
  if (platform === 'bilibili') {
    return new BilibiliSubtitleProvider();
  }
  return null;
}


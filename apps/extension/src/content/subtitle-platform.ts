export type Platform = 'youtube' | 'bilibili' | 'unknown';

export type SupportedPlatform = Exclude<Platform, 'unknown'>;

/**
 * Detect current platform from URL.
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


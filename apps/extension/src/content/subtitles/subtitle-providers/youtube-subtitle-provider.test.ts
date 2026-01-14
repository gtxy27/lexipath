/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '@lexipath/core';
import { SubtitleHttpError } from '@lexipath/subtitles';
import { YouTubeSubtitleProvider } from './youtube-subtitle-provider';

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      sendMessage: vi.fn(async () => ({ success: false, data: '' })),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    i18n: {
      getMessage: (key: string) => key,
    },
  },
}));

vi.mock('@lexipath/subtitles', async () => {
  const actual = (await vi.importActual('@lexipath/subtitles')) as Record<string, unknown>;
  return {
    ...actual,
    getVideoId: vi.fn(() => 'dQw4w9WgXcQ'),
    fetchYouTubeSubtitles: vi.fn(async () => []),
  };
});

import { fetchYouTubeSubtitles } from '@lexipath/subtitles';

describe('YouTubeSubtitleProvider', () => {
  it('finds captions button on Shorts surfaces', async () => {
    document.body.innerHTML = `
      <ytd-reel-player-overlay-renderer>
        <button aria-label="字幕"></button>
      </ytd-reel-player-overlay-renderer>
    `;

    const provider = new YouTubeSubtitleProvider();
    await provider.init('https://www.youtube.com/shorts/dQw4w9WgXcQ', { targetLanguage: 'en' } as Settings);

    const button = (provider as any).findYouTubeCaptionsButton?.() as HTMLElement | null;
    expect(button).toBeInstanceOf(HTMLElement);
  });

  it('polls for live subtitles via callback', async () => {
    vi.useFakeTimers();

    const onSubtitlesMayBeAvailable = vi.fn();
    const provider = new YouTubeSubtitleProvider({ onSubtitlesMayBeAvailable });
    await provider.init('https://www.youtube.com/live/dQw4w9WgXcQ', { targetLanguage: 'en' } as Settings);

    expect(onSubtitlesMayBeAvailable).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(2000);
    expect(onSubtitlesMayBeAvailable).toHaveBeenCalledTimes(1);

    provider.destroy();
    vi.useRealTimers();
  });

  it('returns a premium hint when YouTube fetch is forbidden', async () => {
    vi.mocked(fetchYouTubeSubtitles).mockRejectedValueOnce(
      new SubtitleHttpError('forbidden', { status: 403, statusText: 'Forbidden', url: 'https://www.youtube.com/api/timedtext' })
    );

    const provider = new YouTubeSubtitleProvider();
    await provider.init('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { targetLanguage: 'en' } as Settings);

    const result = await provider.fetchSubtitles();
    expect(result.cues).toEqual([]);
    expect(result.statusMessage).toBe('subtitle_requiresPremium');
  });
});

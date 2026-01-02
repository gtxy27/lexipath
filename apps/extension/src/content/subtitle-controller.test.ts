/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cue, Settings, SubtitleEnhanceOutput } from '@lexipath/core';
import {
  SubtitleController,
  detectPlatform,
  extractVideoInfo,
  type Platform,
} from './subtitle-controller';

// Mock dependencies
vi.mock('../shared/messages', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      sendMessage: vi.fn(async () => ({ success: true, data: 'potc=1' })),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  },
}));

vi.mock('@lexipath/subtitles', () => ({
  getVideoId: vi.fn(),
  fetchYouTubeSubtitles: vi.fn(),
  parseVideoInfo: vi.fn(),
  getCid: vi.fn(),
  fetchBilibiliSubtitles: vi.fn(),
  getBilibiliAvailableTracks: vi.fn(),
}));

vi.mock('./subtitle-overlay', () => {
  const SubtitleOverlay = vi.fn();
  SubtitleOverlay.prototype.mount = vi.fn(() => true);
  SubtitleOverlay.prototype.unmount = vi.fn();
  SubtitleOverlay.prototype.display = vi.fn();
  SubtitleOverlay.prototype.clear = vi.fn();
  SubtitleOverlay.prototype.showWordCardLoading = vi.fn();
  SubtitleOverlay.prototype.showWordCard = vi.fn();
  SubtitleOverlay.prototype.setMode = vi.fn();
  SubtitleOverlay.prototype.getMode = vi.fn(() => 'enhanced');

  return {
    SubtitleOverlay,
  };
});

// Import mocked modules
import { sendMessage } from '../shared/messages';
import {
  getVideoId,
  fetchYouTubeSubtitles,
  parseVideoInfo,
  getCid,
  fetchBilibiliSubtitles,
  getBilibiliAvailableTracks,
} from '@lexipath/subtitles';
import { SubtitleOverlay } from './subtitle-overlay';

describe('detectPlatform', () => {
  it('detects YouTube from various URLs', () => {
    expect(detectPlatform('https://www.youtube.com/watch?v=123')).toBe('youtube');
    expect(detectPlatform('https://youtu.be/123')).toBe('youtube');
    expect(detectPlatform('https://www.YOUTUBE.com/shorts/123')).toBe('youtube');
  });

  it('detects Bilibili from URLs', () => {
    expect(detectPlatform('https://www.bilibili.com/video/BV123')).toBe('bilibili');
    expect(detectPlatform('https://BILIBILI.com/video/BV123')).toBe('bilibili');
  });

  it('returns unknown for other platforms', () => {
    expect(detectPlatform('https://www.example.com')).toBe('unknown');
    expect(detectPlatform('https://vimeo.com/123')).toBe('unknown');
  });
});

describe('extractVideoInfo', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('extracts YouTube video info', async () => {
    vi.mocked(getVideoId).mockReturnValue('dQw4w9WgXcQ');

    const result = await extractVideoInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(result).toEqual({
      platform: 'youtube',
      videoId: 'dQw4w9WgXcQ',
    });
    expect(getVideoId).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('returns null for invalid YouTube URL', async () => {
    vi.mocked(getVideoId).mockReturnValue(null);

    const result = await extractVideoInfo('https://www.youtube.com/invalid');

    expect(result).toBeNull();
  });

  it('extracts Bilibili video info with cid in URL', async () => {
    vi.mocked(parseVideoInfo).mockReturnValue({
      bvid: 'BV1Q5411W7x1',
      cid: '123456',
    });

    const result = await extractVideoInfo('https://www.bilibili.com/video/BV1Q5411W7x1?cid=123456');

    expect(result).toEqual({
      platform: 'bilibili',
      videoId: 'BV1Q5411W7x1',
      extraParams: { cid: '123456' },
    });
  });

  it('fetches cid from API when not in URL', async () => {
    vi.mocked(parseVideoInfo).mockReturnValue({
      bvid: 'BV1Q5411W7x1',
    });
    vi.mocked(getCid).mockResolvedValue('987654');

    const result = await extractVideoInfo('https://www.bilibili.com/video/BV1Q5411W7x1');

    expect(result).toEqual({
      platform: 'bilibili',
      videoId: 'BV1Q5411W7x1',
      extraParams: { cid: '987654' },
    });
    expect(getCid).toHaveBeenCalledWith('BV1Q5411W7x1');
  });

  it('returns null when cid fetch fails', async () => {
    vi.mocked(parseVideoInfo).mockReturnValue({
      bvid: 'BV1Q5411W7x1',
    });
    vi.mocked(getCid).mockRejectedValue(new Error('API error'));

    const result = await extractVideoInfo('https://www.bilibili.com/video/BV1Q5411W7x1');

    expect(result).toBeNull();
  });

  it('returns null for unknown platform', async () => {
    const result = await extractVideoInfo('https://www.example.com');

    expect(result).toBeNull();
  });
});

describe('SubtitleController', () => {
  let controller: SubtitleController;
  let videoElement: HTMLVideoElement;
  let videoContainer: HTMLDivElement;

  beforeEach(() => {
    // Clear mocks
    vi.clearAllMocks();

    // Setup DOM
    document.body.innerHTML = '';
    videoContainer = document.createElement('div');
    videoContainer.id = 'movie_player';
    document.body.appendChild(videoContainer);

    videoElement = document.createElement('video');
    document.body.appendChild(videoElement);

    // Create controller
    const settings: Settings = {
      nativeLanguage: 'zh-CN',
      targetLanguage: 'en',
      proficiencyLevel: 'B1',
      modelConcurrencyLimits: {},
      enabled: true,
      autoEnhance: true,
      siteMode: 'all',
      excludedSites: [],
      allowedSites: [],
    };
    controller = new SubtitleController(settings);

    vi.mocked(sendMessage).mockImplementation(async (type) => {
      if (type === 'SELECT_KEYWORDS') {
        return { ok: true, value: [] };
      }
      if (type === 'EXPLAIN_WORD') {
        return { ok: true, value: { word: 'test', definition: 'definition' } };
      }
      return { ok: true, value: { line1_final: 'Enhanced' } as SubtitleEnhanceOutput };
    });
  });

  afterEach(() => {
    controller?.destroy();
  });

  describe('init', () => {
    it('initializes successfully for YouTube', async () => {
      const mockCues: Cue[] = [
        {
          id: 'youtube:test:0-1000:0',
          startMs: 0,
          endMs: 1000,
          text: 'Test subtitle',
          lang: 'en',
          source: 'youtube',
        },
      ];

      vi.mocked(getVideoId).mockReturnValue('dQw4w9WgXcQ');
      vi.mocked(fetchYouTubeSubtitles).mockResolvedValue(mockCues);
      vi.mocked(sendMessage).mockImplementation(async (type) => {
        if (type === 'SELECT_KEYWORDS') return { ok: true, value: [] };
        return { ok: true, value: { line1_final: 'Enhanced test' } as SubtitleEnhanceOutput };
      });

      const result = await controller.init('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

      expect(result).toBe(true);
      expect(SubtitleOverlay).toHaveBeenCalledWith('youtube', expect.any(Object));
      expect(vi.mocked(SubtitleOverlay.prototype.mount)).toHaveBeenCalled();
      expect(fetchYouTubeSubtitles).toHaveBeenCalledWith('dQw4w9WgXcQ', 'en', { additionalParams: 'potc=1' });
    });

    it('initializes successfully for Bilibili', async () => {
      const mockCues: Cue[] = [
        {
          id: 'bilibili:0-1000:0',
          startMs: 0,
          endMs: 1000,
          text: 'Test subtitle',
          lang: 'en',
          source: 'bilibili',
        },
      ];

      const mockTracks = [
        { languageCode: 'en', name: 'English', url: 'https://subtitle.url' },
      ];

      vi.mocked(parseVideoInfo).mockReturnValue({
        bvid: 'BV1Q5411W7x1',
        cid: '123456',
      });
      vi.mocked(getBilibiliAvailableTracks).mockResolvedValue(mockTracks);
      vi.mocked(fetchBilibiliSubtitles).mockResolvedValue(mockCues);
      vi.mocked(sendMessage).mockImplementation(async (type) => {
        if (type === 'SELECT_KEYWORDS') return { ok: true, value: [] };
        return { ok: true, value: { line1_final: 'Enhanced test' } as SubtitleEnhanceOutput };
      });

      const result = await controller.init('https://www.bilibili.com/video/BV1Q5411W7x1?cid=123456');

      expect(result).toBe(true);
      expect(SubtitleOverlay).toHaveBeenCalledWith('bilibili', expect.any(Object));
      expect(getBilibiliAvailableTracks).toHaveBeenCalledWith('BV1Q5411W7x1', '123456');
      expect(fetchBilibiliSubtitles).toHaveBeenCalledWith('https://subtitle.url');
    });

    it('returns false for unsupported platform', async () => {
      const result = await controller.init('https://www.example.com');

      expect(result).toBe(false);
    });

    it('returns false when video element not found', async () => {
      // Remove video element
      videoElement.remove();

      vi.mocked(getVideoId).mockReturnValue('dQw4w9WgXcQ');

      const result = await controller.init('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

      expect(result).toBe(false);
    });

    it('returns false when overlay mount fails', async () => {
      vi.mocked(getVideoId).mockReturnValue('dQw4w9WgXcQ');
      vi.mocked(SubtitleOverlay.prototype.mount).mockReturnValue(false);

      const result = await controller.init('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

      expect(result).toBe(false);
    });
  });

  describe('destroy', () => {
    it('cleans up resources', async () => {
      vi.mocked(getVideoId).mockReturnValue('dQw4w9WgXcQ');
      vi.mocked(fetchYouTubeSubtitles).mockResolvedValue([]);
      vi.mocked(sendMessage).mockImplementation(async (type) => {
        if (type === 'SELECT_KEYWORDS') return { ok: true, value: [] };
        return { ok: true, value: {} as SubtitleEnhanceOutput };
      });

      await controller.init('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      controller.destroy();

      expect(vi.mocked(SubtitleOverlay.prototype.unmount)).toHaveBeenCalled();
    });
  });

  describe('subtitle enhancement', () => {
    it('enhances all fetched subtitles', async () => {
      const mockCues: Cue[] = [
        {
          id: 'cue1',
          startMs: 0,
          endMs: 1000,
          text: 'First subtitle',
          lang: 'en',
          source: 'youtube',
        },
        {
          id: 'cue2',
          startMs: 1000,
          endMs: 2000,
          text: 'Second subtitle',
          lang: 'en',
          source: 'youtube',
        },
      ];

      vi.mocked(getVideoId).mockReturnValue('test123');
      vi.mocked(fetchYouTubeSubtitles).mockResolvedValue(mockCues);
      vi.mocked(SubtitleOverlay.prototype.mount).mockReturnValue(true); // Ensure mount succeeds
      vi.mocked(sendMessage).mockImplementation(async (type) => {
        if (type === 'SELECT_KEYWORDS') return { ok: true, value: [] };
        return { ok: true, value: { line1_final: 'Enhanced' } as SubtitleEnhanceOutput };
      });

      await controller.init('https://www.youtube.com/watch?v=test123');

      // Should start enhancing cues (concurrency-limited, but 2 cues should both start)
      const enhanceCalls = vi.mocked(sendMessage).mock.calls.filter(([type]) => type === 'ENHANCE_SUBTITLE');
      expect(enhanceCalls).toHaveLength(2);
      expect(sendMessage).toHaveBeenCalledWith('ENHANCE_SUBTITLE', {
        subtitle: 'First subtitle',
        sourceLang: 'en',
        mode: 'single',
      });
      expect(sendMessage).toHaveBeenCalledWith('ENHANCE_SUBTITLE', {
        subtitle: 'Second subtitle',
        sourceLang: 'en',
        mode: 'single',
      });
    });

    it('handles enhancement failures gracefully', async () => {
      const mockCues: Cue[] = [
        {
          id: 'cue1',
          startMs: 0,
          endMs: 1000,
          text: 'Test',
          lang: 'en',
          source: 'youtube',
        },
      ];

      vi.mocked(getVideoId).mockReturnValue('test123');
      vi.mocked(fetchYouTubeSubtitles).mockResolvedValue(mockCues);
      vi.mocked(SubtitleOverlay.prototype.mount).mockReturnValue(true); // Ensure mount succeeds
      vi.mocked(sendMessage).mockResolvedValue({
        ok: false,
        error: { code: 'ERROR', message: 'Enhancement failed' },
      });

      const result = await controller.init('https://www.youtube.com/watch?v=test123');

      // Should still initialize successfully even if enhancement fails
      expect(result).toBe(true);
    });
  });

  describe('Bilibili subtitle track selection', () => {
    it('prefers English track when available', async () => {
      const mockTracks = [
        { languageCode: 'zh-Hans', name: 'Chinese', url: 'https://chinese.url' },
        { languageCode: 'en', name: 'English', url: 'https://english.url' },
        { languageCode: 'ja', name: 'Japanese', url: 'https://japanese.url' },
      ];

      vi.mocked(parseVideoInfo).mockReturnValue({
        bvid: 'BV1Q5411W7x1',
        cid: '123456',
      });
      vi.mocked(getBilibiliAvailableTracks).mockResolvedValue(mockTracks);
      vi.mocked(fetchBilibiliSubtitles).mockResolvedValue([]);
      vi.mocked(SubtitleOverlay.prototype.mount).mockReturnValue(true); // Ensure mount succeeds
      vi.mocked(sendMessage).mockImplementation(async (type) => {
        if (type === 'SELECT_KEYWORDS') return { ok: true, value: [] };
        return { ok: true, value: {} as SubtitleEnhanceOutput };
      });

      await controller.init('https://www.bilibili.com/video/BV1Q5411W7x1?cid=123456');

      // Should fetch English track
      expect(fetchBilibiliSubtitles).toHaveBeenCalledWith('https://english.url');
    });

    it('falls back to first track when English not available', async () => {
      const mockTracks = [
        { languageCode: 'zh-Hans', name: 'Chinese', url: 'https://chinese.url' },
        { languageCode: 'ja', name: 'Japanese', url: 'https://japanese.url' },
      ];

      vi.mocked(parseVideoInfo).mockReturnValue({
        bvid: 'BV1Q5411W7x1',
        cid: '123456',
      });
      vi.mocked(getBilibiliAvailableTracks).mockResolvedValue(mockTracks);
      vi.mocked(fetchBilibiliSubtitles).mockResolvedValue([]);
      vi.mocked(SubtitleOverlay.prototype.mount).mockReturnValue(true); // Ensure mount succeeds
      vi.mocked(sendMessage).mockImplementation(async (type) => {
        if (type === 'SELECT_KEYWORDS') return { ok: true, value: [] };
        return { ok: true, value: {} as SubtitleEnhanceOutput };
      });

      await controller.init('https://www.bilibili.com/video/BV1Q5411W7x1?cid=123456');

      // Should fetch first track (Chinese)
      expect(fetchBilibiliSubtitles).toHaveBeenCalledWith('https://chinese.url');
    });
  });
});

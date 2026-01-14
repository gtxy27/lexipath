/**
 * @vitest-environment happy-dom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cue, Response, Settings, SubtitleEnhanceOutput } from '@lexipath/core';
import {
  SubtitleController,
  detectPlatform,
  type Platform,
} from './subtitle-controller';
import { createSubtitleProvider } from './subtitle-providers/create-subtitle-provider';
import { YouTubeSubtitleProvider } from './subtitle-providers/youtube-subtitle-provider';

// Mock dependencies
vi.mock('../../shared/messages', () => ({
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

vi.mock('../ui', () => {
  const SubtitleOverlay = vi.fn();
  SubtitleOverlay.prototype.mount = vi.fn(() => true);
  SubtitleOverlay.prototype.unmount = vi.fn();
  SubtitleOverlay.prototype.display = vi.fn();
  SubtitleOverlay.prototype.clear = vi.fn();
  SubtitleOverlay.prototype.showWordCardLoading = vi.fn();
  SubtitleOverlay.prototype.showWordCard = vi.fn();
  SubtitleOverlay.prototype.setWordCardConfig = vi.fn();
  SubtitleOverlay.prototype.setModeLabels = vi.fn();
  SubtitleOverlay.prototype.setMode = vi.fn();
  SubtitleOverlay.prototype.getMode = vi.fn(() => 'enhanced');

  return {
    SubtitleOverlay,
  };
});

// Import mocked modules
import { sendMessage } from '../../shared/messages';
import {
  getVideoId,
  fetchYouTubeSubtitles,
  parseVideoInfo,
  getCid,
  fetchBilibiliSubtitles,
  getBilibiliAvailableTracks,
} from '@lexipath/subtitles';
import { SubtitleOverlay } from '../ui';

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

describe('createSubtitleProvider', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a YouTube provider', () => {
    const provider = createSubtitleProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(provider?.platform).toBe('youtube');
  });

  it('creates a Bilibili provider', () => {
    const provider = createSubtitleProvider('https://www.bilibili.com/video/BV1Q5411W7x1');
    expect(provider?.platform).toBe('bilibili');
  });

  it('returns null for non-video URLs', () => {
    const provider = createSubtitleProvider('https://www.example.com');
    expect(provider).toBeNull();
  });
});

describe('SubtitleController', () => {
  let controller: SubtitleController;
  let videoElement: HTMLVideoElement;
  let videoContainer: HTMLDivElement;
  let paused = false;

  const addBilibiliCaptionsButton = (enabled: boolean) => {
    const button = document.createElement('button');
    button.className = 'bpx-player-ctrl-subtitle';
    if (enabled) {
      button.classList.add('bpx-player-ctrl-btn-active');
    }
    document.body.appendChild(button);
    return button;
  };

  beforeEach(() => {
    // Clear mocks
    vi.clearAllMocks();
    vi.mocked(SubtitleOverlay.prototype.mount).mockReturnValue(true);

    // Setup DOM
    document.body.innerHTML = '';
    videoContainer = document.createElement('div');
    videoContainer.id = 'movie_player';
    document.body.appendChild(videoContainer);

    videoElement = document.createElement('video');
    document.body.appendChild(videoElement);

    paused = false;
    Object.defineProperty(videoElement, 'paused', {
      configurable: true,
      get: () => paused,
    });

    // Create controller
    const settings: Settings = {
      nativeLanguage: 'zh-CN',
      targetLanguage: 'en',
      proficiencyLevel: 'B1',
      targetProficiencyLevel: 'B2',
      theme: 'system',
      promptStyle: 'default',
      llmContextSentences: 1,
      channels: [
        {
          channelId: 1,
          typeId: 1,
          name: 'Test OpenAI',
          model: 'gpt-4o-mini',
          config: { baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test' },
          concurrencyLimit: 15,
          extra: {},
        },
      ],
      behaviorRoutes: {
        select_keywords: { kind: 1, channelId: 1, extra: {} },
        translate: { kind: 2, extra: {} },
        dictionary: { kind: 1, channelId: 1, extra: {} },
        enhance_web: { kind: 1, channelId: 1, extra: {} },
        enhance_subtitle: { kind: 1, channelId: 1, extra: {} },
        chat: { kind: 1, channelId: 1, extra: {} },
      },
      enabled: true,
      autoEnhance: true,
      webEnhanceMode: 'i_plus_1',
      webEnhanceModeNative: 'i_plus_1',
      floatingButtonEnabled: true,
      webShowOriginal: false,
      webSelectionExplainEnabled: true,
      wordCardSectionsOrder: ['definition', 'translation', 'example', 'exampleTranslation'],
      wordCardAutoPronounce: true,
      wordCardEnglishAccent: 'us',
      webStyleMapping: { within: 'dashedLine', out: 'border', forgotten: 'weakened' },
      webCustomCss: '',
      scenesEnabled: { webNative: true, webTarget: true, videoNative: true, videoTarget: true },
      hasCompletedOnboarding: true,
      englishCorrection: {
        enabled: false,
        triggerKey: 'space',
        triggerTimes: 3,
        triggerTimeout: 500,
        autoCloseDelay: 3000,
        showUndoButton: true,
      },
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

    it('passes keywordTranslations to overlay in enhanced mode (context window enabled)', async () => {
      paused = true;

      const mockCues: Cue[] = [
        {
          id: 'youtube:test:0-1000:0',
          startMs: 0,
          endMs: 1000,
          text: 'Hello world',
          lang: 'en',
          source: 'youtube',
        },
      ];

      vi.mocked(getVideoId).mockReturnValue('test123');
      vi.mocked(fetchYouTubeSubtitles).mockResolvedValue(mockCues);

      vi.mocked(sendMessage).mockImplementation(async (type) => {
        if (type === 'SELECT_KEYWORDS') return { ok: true, value: ['world'] };
        if (type === 'TRANSLATE_KEYWORDS') return { ok: true, value: ['world-cn'] };
        if (type === 'EXPLAIN_WORD') return { ok: true, value: { word: 'world', definition: 'definition' } as any };
        return { ok: true, value: { line1_final: 'Hello world' } as SubtitleEnhanceOutput };
      });

      await controller.init('https://www.youtube.com/watch?v=test123');

      // Flush promise chains for SELECT_KEYWORDS -> TRANSLATE_KEYWORDS -> updateSubtitleDisplay.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const displayCalls = vi.mocked(SubtitleOverlay.prototype.display).mock.calls.map((call) => call[0] as any);
      expect(
        displayCalls.some(
          (item) => item?.mode === 'enhanced' && item?.showKeywordTranslations === true && item?.keywordTranslations?.world === 'world-cn'
        )
      ).toBe(true);
    });

    it('shows native translation in bilingual mode', async () => {
      const mockCues: Cue[] = [
        {
          id: 'youtube:test:0-1000:0',
          startMs: 0,
          endMs: 1000,
          text: 'Hello world',
          lang: 'en',
          source: 'youtube',
        },
      ];

      vi.mocked(getVideoId).mockReturnValue('test123');
      vi.mocked(fetchYouTubeSubtitles).mockResolvedValue(mockCues);
      vi.mocked(SubtitleOverlay.prototype.mount).mockReturnValue(true);

      vi.mocked(sendMessage).mockImplementation(async (type, payload) => {
        if (type === 'SELECT_KEYWORDS') return { ok: true, value: [] };
        if (type === 'ENHANCE_SUBTITLE') {
          const mode = (payload as any)?.mode;
          if (mode === 'bilingual') {
            return { ok: true, value: { line1_final: 'Hello world', line2_final: '你好，世界' } as SubtitleEnhanceOutput };
          }
          return { ok: true, value: { line1_final: 'Hello world' } as SubtitleEnhanceOutput };
        }
        return { ok: true, value: { line1_final: 'Enhanced' } as SubtitleEnhanceOutput };
      });

      await controller.init('https://www.youtube.com/watch?v=test123');

      const overlayOptions = vi.mocked(SubtitleOverlay).mock.calls[0]?.[1] as any;
      overlayOptions?.onModeChange?.('bilingual');
      await (controller as any).ensureCueBilingual(mockCues[0]);

      const displayCalls = vi.mocked(SubtitleOverlay.prototype.display).mock.calls;
      const bilingual = displayCalls
        .map((call) => call[0] as any)
        .find((item) => item?.mode === 'bilingual' && item?.lines?.[1]?.text === '你好，世界');
      expect(bilingual).toBeTruthy();
    });

    it('refreshes captions when already enabled but params missing', async () => {
      vi.useFakeTimers();

      const subtitlesButton = document.createElement('button');
      subtitlesButton.className = 'ytp-subtitles-button';
      subtitlesButton.setAttribute('aria-pressed', 'true');

      let captionsKicked = false;
      subtitlesButton.click = vi.fn(() => {
        captionsKicked = true;
      });

      document.body.appendChild(subtitlesButton);

      const browser = await import('webextension-polyfill');
      vi.mocked(browser.default.runtime.sendMessage).mockImplementation(async () => {
        if (captionsKicked) return { success: true, data: 'potc=1' };
        return { success: true, data: '' };
      });

      const provider = new YouTubeSubtitleProvider();
      const settings = (controller as any).settings as Settings;
      vi.mocked(getVideoId).mockReturnValue('test123');
      await provider.init('https://www.youtube.com/watch?v=test123', settings);

      const paramsPromise = (provider as any).tryGetYouTubeAdditionalParams('test123', {
        maxAttempts: 2,
        delayMs: 10,
        forceRefreshIfAlreadyEnabled: true,
      }) as Promise<string>;

      await vi.advanceTimersByTimeAsync(10);
      const params = await paramsPromise;

      expect(subtitlesButton.click).toHaveBeenCalledTimes(2);
      expect(params).toBe('potc=1');

      vi.useRealTimers();
    });

    it('initializes successfully for Bilibili', async () => {
      addBilibiliCaptionsButton(true);

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

    it('does not fetch subtitles when Bilibili captions are off', async () => {
      addBilibiliCaptionsButton(false);

      vi.mocked(parseVideoInfo).mockReturnValue({
        bvid: 'BV1Q5411W7x1',
        cid: '123456',
      });

      const result = await controller.init('https://www.bilibili.com/video/BV1Q5411W7x1?cid=123456');

      expect(result).toBe(true);
      expect(getBilibiliAvailableTracks).not.toHaveBeenCalled();
      expect(fetchBilibiliSubtitles).not.toHaveBeenCalled();
      expect(SubtitleOverlay.prototype.clear).toHaveBeenCalled();
    });

    it('fetches subtitles after Bilibili captions are enabled', async () => {
      const button = addBilibiliCaptionsButton(false);

      const mockTracks = [{ languageCode: 'en', name: 'English', url: 'https://subtitle.url' }];
      vi.mocked(parseVideoInfo).mockReturnValue({
        bvid: 'BV1Q5411W7x1',
        cid: '123456',
      });
      vi.mocked(getBilibiliAvailableTracks).mockResolvedValue(mockTracks);
      vi.mocked(fetchBilibiliSubtitles).mockResolvedValue([]);

      const result = await controller.init('https://www.bilibili.com/video/BV1Q5411W7x1?cid=123456');
      expect(result).toBe(true);
      expect(getBilibiliAvailableTracks).not.toHaveBeenCalled();

      button.classList.add('bpx-player-ctrl-btn-active');
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

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
          lang: 'zh',
          source: 'youtube',
        },
        {
          id: 'cue2',
          startMs: 1000,
          endMs: 2000,
          text: 'Second subtitle',
          lang: 'zh',
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
      expect(sendMessage).toHaveBeenCalledWith(
        'ENHANCE_SUBTITLE',
        expect.objectContaining({
          subtitle: 'First subtitle',
          sourceLang: 'zh',
          mode: 'single',
        })
      );
      expect(sendMessage).toHaveBeenCalledWith(
        'ENHANCE_SUBTITLE',
        expect.objectContaining({
          subtitle: 'Second subtitle',
          sourceLang: 'zh',
          mode: 'single',
        })
      );
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

    it('does not schedule new enhancements while paused', async () => {
      const mockCues: Cue[] = [
        { id: 'cue1', startMs: 0, endMs: 1000, text: 'First subtitle', lang: 'zh', source: 'youtube' },
        { id: 'cue2', startMs: 1000, endMs: 2000, text: 'Second subtitle', lang: 'zh', source: 'youtube' },
        { id: 'cue3', startMs: 2000, endMs: 3000, text: 'Third subtitle', lang: 'zh', source: 'youtube' },
      ];

      vi.mocked(getVideoId).mockReturnValue('test123');
      vi.mocked(fetchYouTubeSubtitles).mockResolvedValue(mockCues);
      vi.mocked(SubtitleOverlay.prototype.mount).mockReturnValue(true);

      const deferred: Array<{ resolve: (value: Response<unknown>) => void; promise: Promise<Response<unknown>> }> = [];
      function makeDeferred() {
        let resolve!: (value: Response<unknown>) => void;
        const promise: Promise<Response<unknown>> = new Promise((r) => {
          resolve = r;
        });
        return { resolve, promise };
      }

      vi.mocked(sendMessage).mockImplementation((type, _payload) => {
        if (type === 'SELECT_KEYWORDS') return Promise.resolve({ ok: true, value: [] });
        if (type === 'ENHANCE_SUBTITLE') {
          const d = makeDeferred();
          deferred.push(d);
          return d.promise;
        }
        return Promise.resolve({ ok: true, value: { line1_final: 'Enhanced' } as SubtitleEnhanceOutput });
      });

      paused = false;
      await controller.init('https://www.youtube.com/watch?v=test123');

      // Two requests should start immediately due to maxEnhanceInFlight=2.
      const started = vi.mocked(sendMessage).mock.calls.filter(([type]) => type === 'ENHANCE_SUBTITLE');
      expect(started).toHaveLength(2);

      // Pause before any in-flight enhancement finishes; subsequent pump should not schedule more.
      paused = true;
      videoElement.dispatchEvent(new Event('pause'));

      deferred[0]?.resolve({ ok: true, value: { line1_final: 'Enhanced 1' } as SubtitleEnhanceOutput });
      await Promise.resolve();

      const after = vi.mocked(sendMessage).mock.calls.filter(([type]) => type === 'ENHANCE_SUBTITLE');
      expect(after).toHaveLength(2);
    });
  });

  describe('Bilibili subtitle track selection', () => {
    it('prefers English track when available', async () => {
      addBilibiliCaptionsButton(true);

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
      addBilibiliCaptionsButton(true);

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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserMock } = vi.hoisted(() => ({
  browserMock: {
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
  },
}));

vi.mock('webextension-polyfill', () => ({
  default: browserMock,
}));

describe('storage settings migration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('migrates legacy provider + modelConcurrencyLimits to channels + behaviorRoutes', async () => {
    browserMock.storage.local.get.mockResolvedValue({
      settings: {
        provider: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: 'sk-test',
        },
        modelConcurrencyLimits: {
          'https://api.openai.com/v1|gpt-4o-mini': 42,
        },
      },
    });
    browserMock.storage.local.set.mockResolvedValue(undefined);

    const { getSettings } = await import('./storage');
    const settings = await getSettings();

    expect(settings.channels[0]?.channelId).toBe(1);
    expect(settings.channels[0]?.typeId).toBe(1);
    expect(settings.channels[0]?.model).toBe('gpt-4o-mini');
    expect((settings.channels[0]?.config as any)?.baseUrl).toBe('https://api.openai.com/v1');
    expect((settings.channels[0]?.config as any)?.apiKey).toBe('sk-test');
    expect(settings.channels[0]?.concurrencyLimit).toBe(15);

    const selectKeywords = settings.behaviorRoutes.select_keywords;
    const translate = settings.behaviorRoutes.translate;

    expect(selectKeywords).toBeDefined();
    expect(translate).toBeDefined();

    expect(selectKeywords!.kind).toBe(1);
    expect(selectKeywords!.channelId).toBe(1);
    expect(translate!.kind).toBe(1);
    expect(translate!.channelId).toBe(1);

    expect(browserMock.storage.local.set).toHaveBeenCalledTimes(1);
    const setArg = browserMock.storage.local.set.mock.calls[0]?.[0] as any;
    expect(setArg.settings.provider).toBeUndefined();
    expect(setArg.settings.modelConcurrencyLimits).toBeUndefined();
    expect(Array.isArray(setArg.settings.channels)).toBe(true);
    expect(setArg.settings.channels[0].channelId).toBe(1);
  });
});

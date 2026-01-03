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

  it('migrates legacy provider + modelConcurrencyLimits to channels + channelConcurrencyLimits', async () => {
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

    expect(settings.channels.openai?.baseUrl).toBe('https://api.openai.com/v1');
    expect(settings.channels.openai?.model).toBe('gpt-4o-mini');
    expect(settings.channels.openai?.apiKey).toBe('sk-test');
    expect(settings.keywordProvider).toBe('openai');
    expect(settings.translationProvider).toBe('openai');
    expect(settings.channelConcurrencyLimits.openai).toBe(42);

    expect(browserMock.storage.local.set).toHaveBeenCalledTimes(1);
    const setArg = browserMock.storage.local.set.mock.calls[0]?.[0] as any;
    expect(setArg.settings.channels.openai.baseUrl).toBe('https://api.openai.com/v1');
    expect(setArg.settings.provider).toBeUndefined();
    expect(setArg.settings.modelConcurrencyLimits).toBeUndefined();
  });
});


import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserMock } = vi.hoisted(() => ({
  browserMock: {
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
      },
    },
  },
}));

vi.mock('webextension-polyfill', () => ({
  default: browserMock,
}));

const storageServiceMock = {
  getSettings: vi.fn(),
  setSettings: vi.fn(),
};

vi.mock('./storage-service', () => ({
  getStorageService: () => storageServiceMock,
}));

describe('storage settings migration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storageServiceMock.getSettings.mockResolvedValue(null);
  });

  it('migrates legacy provider + modelConcurrencyLimits to channels + behaviorRoutes', async () => {
    browserMock.storage.local.get.mockResolvedValue({
      settings: {
        provider: {
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini',
          apiKey: 'test-key',
        },
        modelConcurrencyLimits: {
          'https://api.openai.com/v1|gpt-4o-mini': 42,
        },
      },
    });
    browserMock.storage.local.set.mockResolvedValue(undefined);
    storageServiceMock.setSettings.mockResolvedValue(undefined);

    const { getSettings } = await import('./storage');
    const settings = await getSettings();

    expect(settings.channels[0]?.channelId).toBe(1);
    expect(settings.channels[0]?.typeId).toBe(1);
    expect(settings.channels[0]?.model).toBe('gpt-4o-mini');
    const channelConfig = (settings.channels[0]?.config ?? {}) as Record<string, unknown>;
    expect(channelConfig['baseUrl']).toBe('https://api.openai.com/v1');
    expect(channelConfig['apiKey']).toBe('test-key');
    expect(settings.channels[0]?.concurrencyLimit).toBe(15);

    const selectKeywords = settings.behaviorRoutes.select_keywords;
    const translate = settings.behaviorRoutes.translate;

    expect(selectKeywords).toBeDefined();
    expect(translate).toBeDefined();

    expect(selectKeywords!.kind).toBe(1);
    expect(selectKeywords!.channelId).toBe(1);
    expect(translate!.kind).toBe(1);
    expect(translate!.channelId).toBe(1);

    expect(storageServiceMock.setSettings).toHaveBeenCalledTimes(1);
    const persisted = storageServiceMock.setSettings.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(persisted['provider']).toBeUndefined();
    expect(persisted['modelConcurrencyLimits']).toBeUndefined();
    expect(Array.isArray(persisted['channels'])).toBe(true);
    const channels = persisted['channels'] as Array<Record<string, unknown>>;
    expect(channels[0]?.['channelId']).toBe(1);

    expect(browserMock.storage.local.set).toHaveBeenCalledTimes(1);
    expect(browserMock.storage.local.set).toHaveBeenCalledWith({
      settings: expect.objectContaining({ theme: 'system' }),
    });
  });
});

import browser from 'webextension-polyfill';
import {
  LLMProviderChannelSchema,
  TranslationProviderSchema,
  type ProviderChannel,
  SettingsSchema,
  type Settings,
} from '@lexipath/core';

const SETTINGS_KEY = 'settings';
const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

let cachedSettings: Settings | null = null;

function migrateLegacySettings(raw: unknown): { value: unknown; migrated: boolean } {
  if (!raw || typeof raw !== 'object') return { value: raw, migrated: false };

  const record = raw as Record<string, unknown>;
  if (Array.isArray(record.channels) && record.behaviorRoutes && typeof record.behaviorRoutes === 'object') {
    return { value: raw, migrated: false };
  }

  let migrated = false;
  const next: Record<string, unknown> = { ...record };

  const channels: ProviderChannel[] = [];
  const byLegacyProvider = new Map<string, number>();

  const pushChannel = (channel: Omit<ProviderChannel, 'channelId'>) => {
    const channelId = channels.length + 1;
    channels.push({ channelId, ...channel });
    return channelId;
  };

  // Very old schema: { provider: { baseUrl, model, apiKey }, modelConcurrencyLimits }
  if (record.provider && typeof record.provider === 'object') {
    const provider = record.provider as Record<string, unknown>;
    const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl : '';
    const model = typeof provider.model === 'string' ? provider.model : '';
    const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey : undefined;

    const channelId = pushChannel({
      typeId: 1,
      name: 'OpenAI',
      model,
      config: {
        ...(baseUrl ? { baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      },
      concurrencyLimit: 15,
      extra: {},
    });
    byLegacyProvider.set('openai', channelId);
    migrated = true;

    delete next.provider;
    delete next.modelConcurrencyLimits;
  }

  // Legacy v1 schema: { channels: { openai/claude/gemini }, keywordProvider, translationProvider, ... }
  if (!channels.length && record.channels && typeof record.channels === 'object' && !Array.isArray(record.channels)) {
    const legacyChannels = record.channels as Record<string, unknown>;

    const openai = legacyChannels.openai;
    if (openai && typeof openai === 'object') {
      const raw = openai as Record<string, unknown>;
      const channelId = pushChannel({
        typeId: 1,
        name: 'OpenAI',
        model: typeof raw.model === 'string' ? raw.model : '',
        config: {
          ...(typeof raw.baseUrl === 'string' ? { baseUrl: raw.baseUrl } : {}),
          ...(typeof raw.apiKey === 'string' ? { apiKey: raw.apiKey } : {}),
          ...(raw.customHeaders && typeof raw.customHeaders === 'object' ? { customHeaders: raw.customHeaders } : {}),
        },
        concurrencyLimit: 15,
        extra: {},
      });
      byLegacyProvider.set('openai', channelId);
    }

    const claude = legacyChannels.claude;
    if (claude && typeof claude === 'object') {
      const raw = claude as Record<string, unknown>;
      const channelId = pushChannel({
        typeId: 2,
        name: 'Claude',
        model: typeof raw.model === 'string' ? raw.model : '',
        config: {
          ...(typeof raw.apiKey === 'string' ? { apiKey: raw.apiKey } : {}),
          ...(typeof raw.baseUrl === 'string' ? { baseUrl: raw.baseUrl } : {}),
          ...(raw.customHeaders && typeof raw.customHeaders === 'object' ? { customHeaders: raw.customHeaders } : {}),
        },
        concurrencyLimit: 15,
        extra: {},
      });
      byLegacyProvider.set('claude', channelId);
    }

    const gemini = legacyChannels.gemini;
    if (gemini && typeof gemini === 'object') {
      const raw = gemini as Record<string, unknown>;
      const channelId = pushChannel({
        typeId: 3,
        name: 'Gemini',
        model: typeof raw.model === 'string' ? raw.model : '',
        config: {
          ...(typeof raw.apiKey === 'string' ? { apiKey: raw.apiKey } : {}),
          ...(typeof raw.baseUrl === 'string' ? { baseUrl: raw.baseUrl } : {}),
          ...(raw.customHeaders && typeof raw.customHeaders === 'object' ? { customHeaders: raw.customHeaders } : {}),
        },
        concurrencyLimit: 15,
        extra: {},
      });
      byLegacyProvider.set('gemini', channelId);
    }

    migrated = true;
  }

  if (!channels.length) {
    const channelId = pushChannel({
      typeId: 1,
      name: 'Default',
      model: '',
      config: {},
      concurrencyLimit: 15,
      extra: {},
    });
    byLegacyProvider.set('openai', channelId);
    migrated = true;
  }

  const firstChannelId = channels[0]?.channelId ?? 1;
  const resolveLegacyProviderChannelId = (provider: unknown): number => {
    const parsed = LLMProviderChannelSchema.safeParse(provider);
    if (!parsed.success) return firstChannelId;
    return byLegacyProvider.get(parsed.data) ?? firstChannelId;
  };

  const legacyKeywordProvider = (record as any).keywordProvider;
  const legacyTranslationProvider = (record as any).translationProvider;

  const keywordChannelId = resolveLegacyProviderChannelId(legacyKeywordProvider);

  const translateRoute = (() => {
    const parsed = TranslationProviderSchema.safeParse(legacyTranslationProvider);
    const value = parsed.success ? parsed.data : 'openai';
    if (value === 'google') return { kind: 2 as const, extra: {} as const };
    if (value === 'bing') return { kind: 3 as const, extra: {} as const };
    return { kind: 1 as const, channelId: resolveLegacyProviderChannelId(value), extra: {} as const };
  })();

  const enhanceChannelId = (() => {
    const parsed = LLMProviderChannelSchema.safeParse(legacyTranslationProvider);
    if (parsed.success) return resolveLegacyProviderChannelId(parsed.data);
    return keywordChannelId;
  })();

  next.channels = channels;
  next.behaviorRoutes = {
    select_keywords: { kind: 1, channelId: keywordChannelId, extra: {} },
    translate: translateRoute,
    dictionary: translateRoute,
    enhance_web: { kind: 1, channelId: enhanceChannelId, extra: {} },
    enhance_subtitle: { kind: 1, channelId: enhanceChannelId, extra: {} },
    chat: { kind: 1, channelId: enhanceChannelId, extra: {} },
    explain_word: { kind: 1, channelId: enhanceChannelId, extra: {} },
  };

  if (migrated) {
    delete (next as any).keywordProvider;
    delete (next as any).translationProvider;
    delete (next as any).channelConcurrencyLimits;
  }

  return { value: next, migrated };
}

export async function getSettings(): Promise<Settings> {
  if (cachedSettings) return cachedSettings;

  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY] ?? {};
  const migrated = migrateLegacySettings(raw);
  const parsed = SettingsSchema.safeParse(migrated.value);
  if (parsed.success) {
    cachedSettings = parsed.data;
    if (migrated.migrated) {
      await browser.storage.local.set({ [SETTINGS_KEY]: parsed.data });
    }
    return parsed.data;
  }

  console.warn('[LexiPath] Invalid settings in storage, resetting to defaults');
  cachedSettings = DEFAULT_SETTINGS;
  await browser.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}

export async function setSettings(settings: Partial<Settings>): Promise<void> {
  const partialParsed = SettingsSchema.partial().strict().safeParse(settings);
  if (!partialParsed.success) {
    throw partialParsed.error;
  }

  const current = await getSettings();
  const merged = SettingsSchema.parse({ ...current, ...partialParsed.data });
  await browser.storage.local.set({ [SETTINGS_KEY]: merged });
  cachedSettings = merged;
}

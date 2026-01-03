import browser from 'webextension-polyfill';
import { SettingsSchema, type Settings } from '@lexipath/core';

const SETTINGS_KEY = 'settings';
const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

let cachedSettings: Settings | null = null;

function migrateLegacySettings(raw: unknown): { value: unknown; migrated: boolean } {
  if (!raw || typeof raw !== 'object') return { value: raw, migrated: false };

  const record = raw as Record<string, unknown>;
  if (record.channels && typeof record.channels === 'object') {
    return { value: raw, migrated: false };
  }

  let migrated = false;
  const next: Record<string, unknown> = { ...record };

  if (record.provider && typeof record.provider === 'object') {
    next.channels = { openai: record.provider };
    next.keywordProvider = 'openai';
    next.translationProvider = 'openai';
    migrated = true;

    if (!record.channelConcurrencyLimits && record.modelConcurrencyLimits && typeof record.modelConcurrencyLimits === 'object') {
      const provider = record.provider as Record<string, unknown>;
      const baseUrl = typeof provider.baseUrl === 'string' ? provider.baseUrl : '';
      const model = typeof provider.model === 'string' ? provider.model : '';
      const key = baseUrl && model ? `${baseUrl}|${model}` : '';
      const limits = record.modelConcurrencyLimits as Record<string, unknown>;
      const rawLimit = key ? limits[key] : undefined;
      if (typeof rawLimit === 'number' && Number.isFinite(rawLimit)) {
        next.channelConcurrencyLimits = { openai: rawLimit };
      }
    }
  }

  if (migrated) {
    delete next.provider;
    delete next.modelConcurrencyLimits;
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

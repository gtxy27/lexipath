import browser from 'webextension-polyfill';
import { SettingsSchema, type Settings } from '@lexipath/core';

const SETTINGS_KEY = 'settings';
const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

let cachedSettings: Settings | null = null;

export async function getSettings(): Promise<Settings> {
  if (cachedSettings) return cachedSettings;

  const stored = await browser.storage.local.get(SETTINGS_KEY);
  const parsed = SettingsSchema.safeParse(stored[SETTINGS_KEY] ?? {});
  if (parsed.success) {
    cachedSettings = parsed.data;
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


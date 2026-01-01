/**
 * LexiPath Background Service Worker
 *
 * Handles:
 * - Message routing between content/popup/ui
 * - Provider API calls
 * - Caching and session management
 * - Optional host permissions
 */

import browser from 'webextension-polyfill';
import type { Message, Settings } from '@lexipath/core';
import { SettingsSchema } from '@lexipath/core';

// Default settings
const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

// In-memory cache for settings
let cachedSettings: Settings | null = null;

/**
 * Load settings from storage.
 */
async function loadSettings(): Promise<Settings> {
  if (cachedSettings) return cachedSettings;

  const stored = await browser.storage.local.get('settings');
  cachedSettings = stored.settings
    ? SettingsSchema.parse(stored.settings)
    : DEFAULT_SETTINGS;

  return cachedSettings;
}

/**
 * Save settings to storage.
 */
async function saveSettings(settings: Settings): Promise<void> {
  const validated = SettingsSchema.parse(settings);
  await browser.storage.local.set({ settings: validated });
  cachedSettings = validated;
}

/**
 * Handle incoming messages.
 */
async function handleMessage(
  message: Message,
  _sender: browser.Runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'GET_SETTINGS':
      return { ok: true, value: await loadSettings() };

    case 'SET_SETTINGS':
      await saveSettings(message.payload as Settings);
      return { ok: true, value: null };

    case 'REQUEST_HOST_PERMISSION':
      // TODO: Implement host permission request
      return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not implemented' } };

    case 'ENHANCE_WEB':
      // TODO: Implement web enhancement
      return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not implemented' } };

    case 'ENHANCE_SUBTITLE':
      // TODO: Implement subtitle enhancement
      return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not implemented' } };

    case 'EXPLAIN_WORD':
      // TODO: Implement word explanation
      return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not implemented' } };

    case 'CHAT':
      // TODO: Implement chat
      return { ok: false, error: { code: 'NOT_IMPLEMENTED', message: 'Not implemented' } };

    default:
      return { ok: false, error: { code: 'UNKNOWN_MESSAGE', message: 'Unknown message type' } };
  }
}

// Register message listener
browser.runtime.onMessage.addListener((message, sender) => {
  return handleMessage(message as Message, sender);
});

// Log startup
console.log('[LexiPath] Background service worker started');

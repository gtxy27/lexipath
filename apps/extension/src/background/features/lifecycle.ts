import browser from 'webextension-polyfill';

import { getErrorMessage } from '@lexipath/core/log';

import { getSettings } from '../../shared/storage';

type LoggerLike = {
  warn: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
};

function openOnboardingPage(): Promise<void> {
  const url = browser.runtime.getURL('src/ui/onboarding/index.html');
  try {
    return browser.tabs.create({ url }).then(() => undefined);
  } catch (error: unknown) {
    void error;
    try {
      globalThis.open?.(url);
    } catch (ignored: unknown) {
      void ignored;
    }
    return Promise.resolve();
  }
}

function isSettingsConfigured(settings: { channels: Array<{ model?: string | null }> }): boolean {
  return settings.channels.some((channel) => Boolean(channel.model?.trim()));
}

export function setupLifecycleListeners(log: LoggerLike) {
  browser.runtime?.onInstalled?.addListener?.((details) => {
    if (details?.reason !== 'install') return;
    void (async () => {
      try {
        const settings = await getSettings();
        if (settings.hasCompletedOnboarding && isSettingsConfigured(settings)) return;
        await openOnboardingPage();
      } catch (error: unknown) {
        log.warn('Failed to auto-open onboarding on install; continuing', { message: getErrorMessage(error) });
      }
    })();
  });

  browser.commands?.onCommand?.addListener?.((command: string, tab?: browser.Tabs.Tab) => {
    if (command !== 'toggle-original') return;
    const tabId = tab?.id;
    if (typeof tabId !== 'number') return;
    void browser.tabs
      .sendMessage(tabId, { type: 'LEXIPATH_TOGGLE_ORIGINAL_TAB' })
      .catch((error: unknown) => {
        log.debug('Failed to send toggle-original to content script; continuing', { message: getErrorMessage(error) });
      });
  });
}


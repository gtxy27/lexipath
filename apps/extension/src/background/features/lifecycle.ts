import browser from 'webextension-polyfill';

import { getErrorMessage } from '@lexipath/core/log';

import { getSettings, setSettings } from '../../shared/storage';

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
  browser.runtime?.onInstalled?.addListener?.((details: unknown) => {
    if (!details || typeof details !== 'object') return;
    const reason = (details as Record<string, unknown>).reason;
    if (reason !== 'install') return;
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

  async function resolveTabId(tab?: browser.Tabs.Tab): Promise<number | null> {
    const direct = tab?.id;
    if (typeof direct === 'number') return direct;
    try {
      const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      const active = tabs?.[0]?.id;
      return typeof active === 'number' ? active : null;
    } catch (error: unknown) {
      log.debug('Failed to resolve active tab for shortcut; continuing', { message: getErrorMessage(error) });
      return null;
    }
  }

  const sidePanelOpenWantedByTabId = new Map<number, boolean>();

  async function openSidePanel(tabId?: number): Promise<void> {
    if (typeof (browser as any).sidePanel?.open !== 'function') return;
    try {
      // Some browsers allow `tabId` to be omitted.
      const args = typeof tabId === 'number' ? { tabId } : undefined;
      await (browser as any).sidePanel.open(args);
    } catch (error: unknown) {
      log.debug('Failed to open side panel via shortcut; continuing', { message: getErrorMessage(error) });
    }
  }

  async function setSidePanelEnabled(tabId: number, enabled: boolean): Promise<void> {
    if (typeof (browser as any).sidePanel?.setOptions !== 'function') return;
    try {
      await (browser as any).sidePanel.setOptions({ tabId, enabled });
    } catch (error: unknown) {
      log.debug('Failed to set side panel options via shortcut; continuing', { message: getErrorMessage(error) });
    }
  }

  function toggleSidePanel(tabId?: number): void {
    // Chrome sidePanel API has no "close" method. Best-effort toggle by enabling/disabling per-tab.
    if (typeof tabId !== 'number') {
      void openSidePanel(undefined);
      return;
    }

    const isOpenWanted = sidePanelOpenWantedByTabId.get(tabId) ?? false;
    if (isOpenWanted) {
      void setSidePanelEnabled(tabId, false);
      sidePanelOpenWantedByTabId.set(tabId, false);
      return;
    }

    // Ensure it's enabled before opening (if we previously disabled it).
    void setSidePanelEnabled(tabId, true);
    void openSidePanel(tabId);
    sidePanelOpenWantedByTabId.set(tabId, true);
  }

  browser.commands?.onCommand?.addListener?.(async (command: string, tab?: browser.Tabs.Tab) => {
    if (command === 'toggle-sidebar') {
      // Attempt to preserve user activation by opening/closing immediately, without awaiting extra work.
      const directTabId = tab?.id;
      toggleSidePanel(typeof directTabId === 'number' ? directTabId : undefined);

      // If no tab id was provided, best-effort retry using a query.
      if (typeof directTabId !== 'number') {
        void (async () => {
          const resolved = await resolveTabId(undefined);
          if (typeof resolved === 'number') toggleSidePanel(resolved);
        })();
      }
      return;
    }

    const tabId = await resolveTabId(tab);

    if (command === 'toggle-floating-button') {
      try {
        const settings = await getSettings();
        const next = !(settings.floatingButtonEnabled ?? true);
        await setSettings({ floatingButtonEnabled: next });
      } catch (error: unknown) {
        log.debug('Failed to toggle floating button setting; continuing', { message: getErrorMessage(error) });
      }
      return;
    }

    if (typeof tabId !== 'number') return;

    const messageType = (() => {
      switch (command) {
        case 'toggle-original':
          return 'LEXIPATH_TOGGLE_ORIGINAL_TAB';
        case 'toggle-enhance-paused':
          return 'LEXIPATH_TOGGLE_ENHANCE_PAUSED_TAB';
        case 'toggle-subtitle-bilingual':
          return 'LEXIPATH_TOGGLE_SUBTITLE_BILINGUAL';
        default:
          return null;
      }
    })();

    if (!messageType) return;

    try {
      await browser.tabs.sendMessage(tabId, { type: messageType });
    } catch (error: unknown) {
      log.debug(`Failed to send ${command} to content script; continuing`, { message: getErrorMessage(error) });
    }
  });
}


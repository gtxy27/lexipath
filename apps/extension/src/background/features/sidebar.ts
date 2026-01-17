import browser from 'webextension-polyfill';

import { createLogger } from '@lexipath/core/log';

import type { createMessageHandlerRegistry } from '../../shared/messages';
import type { Translator } from '../lib/i18n';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;

const log = createLogger('background:sidebar');

async function openSidePanel(tabId?: number) {
  if (typeof (browser as any).sidePanel?.open === 'function') {
    await (browser as any).sidePanel.open({ tabId });
  }
}

export function registerSidebarFeature(options: { registry: Registry; t: Translator }) {
  const { registry, t } = options;

  registry.register('OPEN_SIDEBAR', async (payload, sender) => {
    const tabId = sender?.tab?.id;

    // Start persisting the pending message as early as possible, but do not await it before attempting
    // to open the side panel. Chrome requires `sidePanel.open()` to be called in response to a user gesture,
    // and awaiting storage can break the user activation chain.
    const pendingWritePromise = payload?.initialMessage
      ? browser.storage.local
          .set({
            lexipath_sidebar_pending_message: {
              nonce: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              text: payload.initialMessage,
              keyword: typeof payload.keyword === 'string' ? payload.keyword : undefined,
              contextInfo: payload.contextInfo,
              timestamp: Date.now(),
              isAutoSend: payload.isAutoSend ?? false,
            },
          })
          .catch((error: unknown) => {
            log.warn('Failed to persist pending sidebar message; opening sidebar anyway', { tabId, error });
          })
      : Promise.resolve();

    // IMPORTANT: `sidePanel.open()` must be called in response to a user gesture.
    // Keep it as early as possible to avoid losing user activation.
    await openSidePanel(tabId).catch((error: unknown) => {
      log.warn('Failed to open side panel', { tabId, error });
    });

    await pendingWritePromise;
    return { ok: true };
  });

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: 'lexipath-explain-selection',
      title: `${t('extensionName')}: ${t('contextMenu_explainSelection')}`,
      contexts: ['selection'],
    });
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === 'lexipath-explain-selection' && info.selectionText) {
      const selectedText = info.selectionText.trim();
      if (!selectedText) return;

      const prompt = `Please explain this sentence or phrase: "${selectedText}"`;

      const tabId = tab?.id;

      const contextInfo = await (async () => {
        if (typeof tabId !== 'number') return undefined;
        try {
          const response = await browser.tabs.sendMessage(tabId, { type: 'LEXIPATH_GET_WEB_SELECTION_CONTEXT' });
          if (!response || typeof response !== 'object') return undefined;
          const kind = (response as Record<string, unknown>).kind;
          if (kind !== 'web') return undefined;
          return response;
        } catch (error: unknown) {
          log.warn('Failed to read web selection context from tab; continuing without context', { tabId, error });
          return undefined;
        }
      })();

      const pendingWritePromise = browser.storage.local
        .set({
          lexipath_sidebar_pending_message: {
            nonce: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            text: prompt,
            timestamp: Date.now(),
            isAutoSend: true,
            ...(contextInfo ? { contextInfo } : {}),
          },
        })
        .catch((error: unknown) => {
          log.warn('Failed to persist pending sidebar message from context menu; opening sidebar anyway', { tabId, error });
        });

      await openSidePanel(tabId).catch((error: unknown) => {
        log.warn('Failed to open side panel from context menu', { tabId, error });
      });

      await pendingWritePromise;
    }
  });
}


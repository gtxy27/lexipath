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

    // Start persisting the pending message as early as possible, but never block opening the sidebar on storage failures.
    const pendingWritePromise = payload?.initialMessage
      ? browser.storage.local
          .set({
            lexipath_sidebar_pending_message: {
              text: payload.initialMessage,
              keyword: typeof payload.keyword === 'string' ? payload.keyword : undefined,
              contextInfo: payload.contextInfo,
              timestamp: Date.now(),
              isAutoSend: payload.isAutoSend ?? false,
            },
          })
          .catch((error: unknown) => {
            // Never block opening the sidebar on storage failures (quota / serialization / etc.).
            log.warn('Failed to persist pending sidebar message; opening sidebar anyway', { tabId, error });
          })
      : Promise.resolve();

    await openSidePanel(tabId).catch((error: unknown) => {
      log.warn('Failed to open side panel', { tabId, error });
    });

    // Ensure the pending message write has had a chance to finish before resolving OPEN_SIDEBAR.
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

      const pendingWritePromise = browser.storage.local
        .set({
          lexipath_sidebar_pending_message: {
            text: prompt,
            timestamp: Date.now(),
            isAutoSend: true,
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


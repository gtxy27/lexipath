import browser from 'webextension-polyfill';

import type { createMessageHandlerRegistry } from '../../shared/messages';
import type { Translator } from '../lib/i18n';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;

async function openSidePanel(tabId?: number) {
  if (typeof (browser as any).sidePanel?.open === 'function') {
    await (browser as any).sidePanel.open({ tabId });
  }
}

export function registerSidebarFeature(options: { registry: Registry; t: Translator }) {
  const { registry, t } = options;

  registry.register('OPEN_SIDEBAR', async (payload, sender) => {
    await openSidePanel(sender?.tab?.id);
    if (payload?.initialMessage) {
      await browser.storage.local.set({
        lexipath_sidebar_pending_message: {
          text: payload.initialMessage,
          keyword: typeof payload.keyword === 'string' ? payload.keyword : undefined,
          contextInfo: payload.contextInfo,
          timestamp: Date.now(),
          isAutoSend: payload.isAutoSend ?? false,
        },
      });
    }
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

      await openSidePanel(tab?.id);
      await browser.storage.local.set({
        lexipath_sidebar_pending_message: {
          text: prompt,
          timestamp: Date.now(),
          isAutoSend: true,
        },
      });
    }
  });
}


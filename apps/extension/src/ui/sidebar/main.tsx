import React from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';
import { ThemeSchema, type Theme } from '@lexipath/core';
import { Sidebar } from './Sidebar';
import '../styles.css';
import { applyThemeToDocument } from '../lib/theme';

function t(key: string): string {
  return browser.i18n.getMessage(key) || key;
}

document.title = t('chatPageTitle');

function startThemeSync(): void {
  const apply = (theme: Theme) => applyThemeToDocument(theme);

  void (async () => {
    try {
      const stored = await browser.storage.local.get('settings');
      const parsed = ThemeSchema.safeParse((stored as any)?.settings?.theme);
      apply(parsed.success ? parsed.data : 'system');
    } catch {
      apply('system');
    }
  })();

  browser.storage?.onChanged?.addListener?.((changes: any, area: string) => {
    if (area !== 'local') return;
    const next = changes?.settings?.newValue;
    const parsed = ThemeSchema.safeParse(next?.theme);
    if (parsed.success) apply(parsed.data);
  });
}

startThemeSync();

const root = createRoot(document.getElementById('root')!);
root.render(<Sidebar />);

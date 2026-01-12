import browser from 'webextension-polyfill';
import { ThemeSchema, type Theme } from '@lexipath/core';
import { getErrorMessage } from '@lexipath/core/log';

import { applyThemeToDocument } from './theme';

type LoggerLike = {
  warn: (message: string, meta?: Record<string, unknown>) => void;
};

export function startThemeSync(log: LoggerLike): void {
  const apply = (theme: Theme) => applyThemeToDocument(theme);

  void (async () => {
    try {
      const stored = await browser.storage.local.get('settings');
      const parsed = ThemeSchema.safeParse((stored as any)?.settings?.theme);
      apply(parsed.success ? parsed.data : 'system');
    } catch (error: unknown) {
      log.warn('Failed to load stored theme; using system', { message: getErrorMessage(error) });
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


import browser from 'webextension-polyfill';

export function getI18nMessage(key: string, substitutions?: string | string[], fallback = ''): string {
  try {
    const message = browser.i18n?.getMessage?.(key, substitutions as any);
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // ignore
  }
  return fallback;
}


import browser from 'webextension-polyfill';
import { createLogger, getErrorMessage } from '@lexipath/core/log';

const log = createLogger('content:i18n');

export function getI18nMessage(key: string, substitutions?: string | string[], fallback = ''): string {
  try {
    const message = browser.i18n?.getMessage?.(key, substitutions as any);
    if (typeof message === 'string' && message.trim()) return message;
  } catch (error: unknown) {
    log.debug('i18n.getMessage threw; returning fallback', { key, message: getErrorMessage(error) });
  }
  return fallback;
}

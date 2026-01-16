import browser from 'webextension-polyfill';

export type LoggerLike = {
  debug: (message: string, meta?: Record<string, unknown>) => void;
};

export type Translator = (key: string, substitutions?: string | string[], fallback?: string) => string;

export function createTranslator(log: LoggerLike): Translator {
  return (key: string, substitutions?: string | string[], fallback = ''): string => {
    try {
      const message =
        substitutions === undefined
          ? browser.i18n?.getMessage?.(key)
          : browser.i18n?.getMessage?.(key, substitutions);
      if (typeof message === 'string' && message.trim()) return message;
    } catch (error: unknown) {
      log.debug('i18n.getMessage threw; falling back', { key, error });
    }
    return fallback || key;
  };
}

/**
 * Returns localized message if available; otherwise returns `fallback`.
 * Default fallback is empty string to preserve existing content-script behavior
 * (many call sites use `|| 'Some English'` as the final fallback).
 */
export function getI18nMessage(key: string, substitutions?: string | string[], fallback = ''): string {
  try {
    const message =
      substitutions === undefined
        ? browser.i18n?.getMessage?.(key)
        : browser.i18n?.getMessage?.(key, substitutions);
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // Keep this helper side-effect free by default.
  }
  return fallback;
}

/**
 * UI-friendly i18n helper that falls back to the key itself.
 */
export function t(key: string, substitutions?: string | string[]): string {
  const message = getI18nMessage(key, substitutions);
  return message || key;
}

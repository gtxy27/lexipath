import browser from 'webextension-polyfill';

export type LoggerLike = {
  debug: (message: string, meta?: Record<string, unknown>) => void;
};

export type Translator = (key: string, substitutions?: string | string[], fallback?: string) => string;

export function createTranslator(log: LoggerLike): Translator {
  return (key: string, substitutions?: string | string[], fallback = ''): string => {
    try {
      const message = browser.i18n?.getMessage?.(key, substitutions as any);
      if (typeof message === 'string' && message.trim()) return message;
    } catch (error: unknown) {
      log.debug('i18n.getMessage threw; falling back to key', { key, error });
    }
    return fallback || key;
  };
}


import browser from 'webextension-polyfill';

import { createLogger } from '@lexipath/core/log';
import { BingTranslateProvider, ClaudeProvider, GeminiProvider, GoogleTranslateProvider, OpenAICompatibleProvider } from '@lexipath/providers';

import { MessageError, type createMessageHandlerRegistry } from '../../shared/messages';

import { DEFAULT_CLAUDE_URL, DEFAULT_GEMINI_URL, DEFAULT_OPENAI_URL } from '../lib/routing';
import type { Translator } from '../lib/i18n';
import { InvalidOriginError, normalizeOriginToHostPattern as normalizeOriginToHostPatternCore } from '../origin';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;

const log = createLogger('background:providers');
const googleTranslateProvider = new GoogleTranslateProvider();
const bingTranslateProvider = new BingTranslateProvider();

function normalizeOriginToHostPattern(t: Translator, origin: string): string {
  try {
    return normalizeOriginToHostPatternCore(origin);
  } catch (error) {
    if (error instanceof InvalidOriginError) {
      throw new MessageError({ code: 'INVALID_ORIGIN', message: t('error_invalidOrigin') });
    }
    throw error;
  }
}

export function registerProviderFeature(options: { registry: Registry; t: Translator }) {
  const { registry, t } = options;

  registry.register('REQUEST_HOST_PERMISSION', async (payload) => {
    const originPattern = normalizeOriginToHostPattern(t, payload.origin);
    try {
      return await browser.permissions.request({ origins: [originPattern] });
    } catch (error: unknown) {
      log.warn('REQUEST_HOST_PERMISSION threw; treating as denied', { originPattern, error });
      return false;
    }
  });

  registry.register('TEST_PROVIDER_CONNECTION', async (payload) => {
    const origin = (() => {
      switch (payload.type) {
        case 'openai':
          return payload.config.baseUrl || DEFAULT_OPENAI_URL;
        case 'claude':
          return payload.config.baseUrl ?? DEFAULT_CLAUDE_URL;
        case 'gemini':
          return payload.config.baseUrl ?? DEFAULT_GEMINI_URL;
        case 'google':
          return 'https://translate.googleapis.com';
        case 'bing':
          return 'https://www.bing.com';
      }
    })();

    const originPattern = normalizeOriginToHostPattern(t, origin);
    let granted = false;
    try {
      granted = await browser.permissions.request({ origins: [originPattern] });
    } catch (error) {
      throw new MessageError({
        code: 'PERMISSION_REQUEST_FAILED',
        message: error instanceof Error ? error.message : 'Could not request host permission',
      });
    }

    if (!granted) {
      throw new MessageError({ code: 'PERMISSION_DENIED', message: 'Permission denied' });
    }

    const check = await (async () => {
      switch (payload.type) {
        case 'openai':
          return new OpenAICompatibleProvider(payload.config).testConnection();
        case 'claude':
          return new ClaudeProvider(payload.config).testConnection();
        case 'gemini':
          return new GeminiProvider(payload.config).testConnection();
        case 'google':
          return googleTranslateProvider.testConnection();
        case 'bing':
          return bingTranslateProvider.testConnection();
      }
    })();

    if (check.ok) return true as const;

    throw new MessageError({ code: check.error.code, message: check.error.message });
  });
}


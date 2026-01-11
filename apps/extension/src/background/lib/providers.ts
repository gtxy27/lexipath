import type {
  ClaudeProviderConfig,
  GeminiProviderConfig,
  LLMProviderChannel,
  ProviderConfig,
} from '@lexipath/core';
import {
  BingTranslateProvider,
  ClaudeProvider,
  GeminiProvider,
  GoogleTranslateProvider,
  OpenAICompatibleProvider,
} from '@lexipath/providers';

import { stableStringify } from '../pipeline';

export type ChatProvider = OpenAICompatibleProvider | ClaudeProvider | GeminiProvider;

const chatProviders = new Map<string, ChatProvider>();

function providerKey(
  type: LLMProviderChannel,
  config: ProviderConfig | ClaudeProviderConfig | GeminiProviderConfig
): string {
  return stableStringify({ type, config });
}

export function getChatProvider(
  type: LLMProviderChannel,
  config: ProviderConfig | ClaudeProviderConfig | GeminiProviderConfig
): ChatProvider {
  const key = providerKey(type, config);
  const existing = chatProviders.get(key);
  if (existing) return existing;

  const created: ChatProvider = (() => {
    switch (type) {
      case 'openai':
        return new OpenAICompatibleProvider(config as ProviderConfig);
      case 'claude':
        return new ClaudeProvider(config as ClaudeProviderConfig);
      case 'gemini':
        return new GeminiProvider(config as GeminiProviderConfig);
    }
  })();

  chatProviders.set(key, created);
  return created;
}

export const googleTranslateProvider = new GoogleTranslateProvider();
export const bingTranslateProvider = new BingTranslateProvider();


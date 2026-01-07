import { describe, expect, it, vi } from 'vitest';
import { LLMDictionaryProvider } from './llm-dictionary';
import type { ChatProvider } from './types';

describe('LLMDictionaryProvider', () => {
  it('builds prompt and parses response', async () => {
    const provider: ChatProvider = {
      chat: vi.fn(async () => ({
        id: '1',
        choices: [
          {
            message: {
              role: 'assistant' as const,
              content: JSON.stringify({
                translation: '你好',
                phonetic: '/həˈloʊ/',
                difficulty: 'A1',
                definition: 'A greeting.',
              }),
            },
            finish_reason: 'stop' as const,
          },
        ],
      })),
    };

    const buildPrompt = vi.fn(() => 'PROMPT');

    const dictionary = new LLMDictionaryProvider({ provider, buildPrompt });
    const result = await dictionary.explainWord({
      word: ' hello ',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'A1',
    });

    expect(buildPrompt).toHaveBeenCalledTimes(1);
    expect(provider.chat).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      word: 'hello',
      definition: 'A greeting.',
      translation: '你好',
      phonetic: '/həˈloʊ/',
      difficulty: 'A1',
    });
  });

  it('throws on invalid response', async () => {
    const provider: ChatProvider = {
      chat: vi.fn(async () => ({
        id: '1',
        choices: [
          { message: { role: 'assistant' as const, content: 'not-json' }, finish_reason: 'stop' as const },
        ],
      })),
    };

    const dictionary = new LLMDictionaryProvider({ provider, buildPrompt: () => 'PROMPT' });

    await expect(
      dictionary.explainWord({
        word: 'hello',
        sourceLang: 'en',
        targetLang: 'zh-CN',
        userLevel: 'A1',
      })
    ).rejects.toThrow(/Failed to parse explain word response/);
  });
});

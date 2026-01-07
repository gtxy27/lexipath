import { describe, expect, it, vi } from 'vitest';
import { TranslateDictionaryProvider } from './translate-dictionary';

describe('TranslateDictionaryProvider', () => {
  it('returns translation as definition', async () => {
    const translate = vi.fn(async () => '你好');
    const dictionary = new TranslateDictionaryProvider({ translate });

    const result = await dictionary.explainWord({
      word: 'hello',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'A1',
    });

    expect(translate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ word: 'hello', definition: '你好', translation: '你好' });
  });
});


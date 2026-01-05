import { describe, expect, it } from 'vitest';
import { buildTranslateKeywordsPrompt, parseTranslateKeywordsResponse } from './translate-keywords-prompt';

describe('buildTranslateKeywordsPrompt', () => {
  it('includes language info and keywords', () => {
    const prompt = buildTranslateKeywordsPrompt({
      keywords: ['hello', 'world'],
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'B1',
    });

    expect(prompt).toContain('en');
    expect(prompt).toContain('zh-CN');
    expect(prompt).toContain('hello');
    expect(prompt).toContain('world');
  });
});

describe('parseTranslateKeywordsResponse', () => {
  it('parses newline-separated translations', () => {
    const result = parseTranslateKeywordsResponse('你好\n世界\n', 2);
    expect(result.ok).toBe(true);
    expect(result.translations).toEqual(['你好', '世界']);
  });

  it('strips numbering and bullets', () => {
    const result = parseTranslateKeywordsResponse('1. 你好\n- 世界\n', 2);
    expect(result.ok).toBe(true);
    expect(result.translations).toEqual(['你好', '世界']);
  });

  it('fails when line count mismatches', () => {
    const result = parseTranslateKeywordsResponse('你好\n世界\n', 3);
    expect(result.ok).toBe(false);
    expect(result.translations).toEqual(['你好', '世界']);
  });
});

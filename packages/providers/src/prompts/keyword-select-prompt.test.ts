import { describe, expect, it } from 'vitest';
import { buildKeywordSelectPrompt, parseKeywordSelectResponse } from './keyword-select-prompt';

describe('buildKeywordSelectPrompt', () => {
  it('includes core constraints and text', () => {
    const prompt = buildKeywordSelectPrompt({
      text: 'This is a test subtitle about taking off and getting used to it.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'B1',
      scene: 'subtitle',
    });

    expect(prompt).toContain('挑选对学习者最有价值');
    expect(prompt).toContain('只输出一个 JSON 字符串数组');
    expect(prompt).toContain('不要输出索引/位置');
    expect(prompt).toContain('排除人名、地名');
    expect(prompt).toContain('This is a test subtitle');
  });
});

describe('parseKeywordSelectResponse', () => {
  it('parses a plain JSON array', () => {
    const result = parseKeywordSelectResponse('["take off","get used to","subtitle"]');
    expect(result.ok).toBe(true);
    expect(result.keywords).toEqual(['take off', 'get used to', 'subtitle']);
  });

  it('parses JSON wrapped in code fences', () => {
    const result = parseKeywordSelectResponse('```json\n["a","b"]\n```');
    expect(result.ok).toBe(true);
    expect(result.keywords).toEqual(['a', 'b']);
  });

  it('extracts the first JSON array from extra text', () => {
    const response = 'Here you go:\n["alpha","beta"]\nThanks!';
    const result = parseKeywordSelectResponse(response);
    expect(result.ok).toBe(true);
    expect(result.keywords).toEqual(['alpha', 'beta']);
  });

  it('dedupes case-insensitively and trims whitespace', () => {
    const result = parseKeywordSelectResponse('["  Test  ","test","TEST","another"]');
    expect(result.ok).toBe(true);
    expect(result.keywords).toEqual(['Test', 'another']);
  });

  it('returns ok=false on invalid JSON', () => {
    const result = parseKeywordSelectResponse('not json');
    expect(result.ok).toBe(false);
    expect(result.keywords).toEqual([]);
  });
});

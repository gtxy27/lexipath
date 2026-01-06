import { describe, expect, it } from 'vitest';
import { BEHAVIORS, resolvePromptScene, resolvePromptStyleValue } from '@lexipath/core';
import { buildTermTranslatePrompt, parseTermTranslateResponse } from './term-translate-prompt';

describe('buildTermTranslatePrompt', () => {
  it('includes language info and terms', () => {
    const prompt = buildTermTranslatePrompt({
      terms: ['hello', 'world'],
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'B1',
      sceneValue: resolvePromptScene('term_translate'),
      styleValue: resolvePromptStyleValue('default'),
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1' },
      behavior: BEHAVIORS.term_translate,
    });

    expect(prompt).toContain('en');
    expect(prompt).toContain('zh-CN');
    expect(prompt).toContain('hello');
    expect(prompt).toContain('world');
  });
});

describe('parseTermTranslateResponse', () => {
  it('parses direct JSON object', () => {
    const result = parseTermTranslateResponse('{"hello":"你好","world":"世界"}');
    expect(result.ok).toBe(true);
    expect(result.translations.hello).toBe('你好');
    expect(result.translations.world).toBe('世界');
  });

  it('parses wrapped translations object', () => {
    const result = parseTermTranslateResponse('{"translations":{"hello":"你好"}}');
    expect(result.ok).toBe(true);
    expect(result.translations.hello).toBe('你好');
  });

  it('parses fenced JSON', () => {
    const result = parseTermTranslateResponse('```json\n{\"hello\":\"你好\"}\n```');
    expect(result.ok).toBe(true);
    expect(result.translations.hello).toBe('你好');
  });
});

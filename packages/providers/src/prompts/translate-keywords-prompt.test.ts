import { describe, expect, it } from 'vitest';
import { BEHAVIORS, resolvePromptScene, resolvePromptStyleValue } from '@lexipath/core';
import { buildTranslateKeywordsPrompt, parseTranslateKeywordsResponse } from './translate-keywords-prompt';

describe('buildTranslateKeywordsPrompt', () => {
  it('includes language info and keywords', () => {
    const prompt = buildTranslateKeywordsPrompt({
      keywords: ['hello', 'world'],
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'B1',
      sceneValue: resolvePromptScene('keyword_translate'),
      styleValue: resolvePromptStyleValue('default'),
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1' },
      behavior: BEHAVIORS.translate_keywords,
    });

    expect(prompt).toContain('en');
    expect(prompt).toContain('zh-CN');
    expect(prompt).toContain('hello');
    expect(prompt).toContain('world');
  });

  it('userInput should only contain pure data without prompt labels (no context)', () => {
    const prompt = buildTranslateKeywordsPrompt({
      keywords: ['hello', 'world'],
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'B1',
      sceneValue: resolvePromptScene('keyword_translate'),
      styleValue: resolvePromptStyleValue('default'),
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1' },
      behavior: BEHAVIORS.translate_keywords,
    });

    // Extract <用户输入> content
    const match = prompt.match(/<用户输入>\n([\s\S]*?)\n<\/用户输入>/);
    expect(match).toBeTruthy();
    const userInput = match![1];

    // userInput should be pure data only
    expect(userInput).toBe('hello\nworld');
    expect(userInput).not.toContain('词汇列表');
    expect(userInput).not.toContain('：');
  });

  it('userInput should contain keywords and context separated by empty line (with context)', () => {
    const prompt = buildTranslateKeywordsPrompt({
      keywords: ['hello', 'world'],
      context: 'This is a greeting',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'B1',
      sceneValue: resolvePromptScene('keyword_translate'),
      styleValue: resolvePromptStyleValue('default'),
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1' },
      behavior: BEHAVIORS.translate_keywords,
    });

    const match = prompt.match(/<用户输入>\n([\s\S]*?)\n<\/用户输入>/);
    expect(match).toBeTruthy();
    const userInput = match![1];

    // Should be: keywords + empty line + context
    expect(userInput).toBe('hello\nworld\n\nThis is a greeting');
    expect(userInput).not.toContain('上下文：');
    expect(userInput).not.toContain('词汇列表');
  });

  it('outputNotes should explain input format', () => {
    const prompt = buildTranslateKeywordsPrompt({
      keywords: ['hello'],
      context: 'greeting',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'B1',
      sceneValue: resolvePromptScene('keyword_translate'),
      styleValue: resolvePromptStyleValue('default'),
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1' },
      behavior: BEHAVIORS.translate_keywords,
    });

    // outputNotes should explain input format
    expect(prompt).toContain('输入格式');
    expect(prompt).toContain('待翻译的词汇列表');
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

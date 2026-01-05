import { describe, it, expect } from 'vitest';
import {
  buildExplainWordPrompt,
  parseExplainWordResponse,
  type ExplainWordPromptOptions,
} from '../prompts/explain-word-prompt';

describe('buildExplainWordPrompt', () => {
  it('should build prompt without context', () => {
    const options: ExplainWordPromptOptions = {
      word: 'serendipity',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'B2',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('serendipity');
    expect(prompt).toContain('英语');
    expect(prompt).toContain('B2');
    expect(prompt).toContain('简体中文');
    expect(prompt).toContain('IPA 音标');
    expect(prompt).toContain('"translation"');
    expect(prompt).toContain('"phonetic"');
    expect(prompt).toContain('"difficulty"');
    expect(prompt).toContain('"definition"');
    expect(prompt).toContain('"example"');
    expect(prompt).toContain('输出约束');
    expect(prompt).not.toContain('<上下文信息>');
  });

  it('should build prompt with context', () => {
    const options: ExplainWordPromptOptions = {
      word: 'bank',
      context: 'I walked along the river bank.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'A2',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('bank');
    expect(prompt).toContain('<上下文信息>');
    expect(prompt).toContain('上文：');
    expect(prompt).toContain('I walked along the river bank');
    expect(prompt).toContain('与语境最相关');
  });

  it('should use correct phonetic instruction for English', () => {
    const options: ExplainWordPromptOptions = {
      word: 'example',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'B1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('给出英文单词的 IPA 音标');
  });

  it('should use correct phonetic instruction for Chinese', () => {
    const options: ExplainWordPromptOptions = {
      word: '学习',
      sourceLang: 'zh',
      targetLang: 'en',
      userLevel: 'B1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('给出中文词语的拼音');
  });

  it('should use correct phonetic instruction for Japanese', () => {
    const options: ExplainWordPromptOptions = {
      word: '勉強',
      sourceLang: 'ja',
      targetLang: 'en',
      userLevel: 'B1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('罗马音');
  });

  it('should use correct phonetic instruction for Korean', () => {
    const options: ExplainWordPromptOptions = {
      word: '공부',
      sourceLang: 'ko',
      targetLang: 'en',
      userLevel: 'B1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('罗马化');
  });

  it('should use correct phonetic instruction for French', () => {
    const options: ExplainWordPromptOptions = {
      word: 'bonjour',
      sourceLang: 'fr',
      targetLang: 'en',
      userLevel: 'A1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('法语单词的 IPA 音标');
  });

  it('should handle different user proficiency levels', () => {
    const options: ExplainWordPromptOptions = {
      word: 'test',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'C1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('C1');
    expect(prompt).toContain('难度适配 CEFR C1');
  });
});

describe('parseExplainWordResponse', () => {
  it('should parse complete response with all fields', () => {
    const response = JSON.stringify({
      translation: '偶然发现',
      phonetic: '/ˌser.ənˈdɪp.ə.ti/',
      difficulty: 'C2',
      definition: '意外发现有价值事物的能力',
      example: 'Finding this restaurant was pure serendipity.',
      example_translation: '发现这家餐厅纯属偶然。',
    });

    const result = parseExplainWordResponse(response);

    expect(result.translation).toBe('偶然发现');
    expect(result.phonetic).toBe('/ˌser.ənˈdɪp.ə.ti/');
    expect(result.difficulty).toBe('C2');
    expect(result.definition).toBe('意外发现有价值事物的能力');
    expect(result.example).toBe('Finding this restaurant was pure serendipity.');
    expect(result.example_translation).toBe('发现这家餐厅纯属偶然。');
  });

  it('should parse response without example fields', () => {
    const response = JSON.stringify({
      translation: '测试',
      phonetic: '/test/',
      difficulty: 'A2',
      definition: '检查或评估某物',
    });

    const result = parseExplainWordResponse(response);

    expect(result.translation).toBe('测试');
    expect(result.phonetic).toBe('/test/');
    expect(result.difficulty).toBe('A2');
    expect(result.definition).toBe('检查或评估某物');
    expect(result.example).toBeUndefined();
    expect(result.example_translation).toBeUndefined();
  });

  it('should parse JSON wrapped in markdown code block', () => {
    const response = `\`\`\`json
{
  "translation": "例子",
  "phonetic": "/ɪɡˈzæmpəl/",
  "difficulty": "A2",
  "definition": "用来说明或解释的事物"
}
\`\`\``;

    const result = parseExplainWordResponse(response);

    expect(result.translation).toBe('例子');
    expect(result.phonetic).toBe('/ɪɡˈzæmpəl/');
  });

  it('should throw error if translation is missing', () => {
    const response = JSON.stringify({
      phonetic: '/test/',
      difficulty: 'A2',
      definition: 'A test',
    });

    expect(() => parseExplainWordResponse(response)).toThrow('Missing required fields');
  });

  it('should throw error if phonetic is missing', () => {
    const response = JSON.stringify({
      translation: '测试',
      difficulty: 'A2',
      definition: 'A test',
    });

    expect(() => parseExplainWordResponse(response)).toThrow('Missing required fields');
  });

  it('should throw error if difficulty is missing', () => {
    const response = JSON.stringify({
      translation: '测试',
      phonetic: '/test/',
      definition: 'A test',
    });

    expect(() => parseExplainWordResponse(response)).toThrow('Missing required fields');
  });

  it('should throw error if definition is missing', () => {
    const response = JSON.stringify({
      translation: '测试',
      phonetic: '/test/',
      difficulty: 'A2',
    });

    expect(() => parseExplainWordResponse(response)).toThrow('Missing required fields');
  });

  it('should throw error for invalid JSON', () => {
    const response = 'not valid json';

    expect(() => parseExplainWordResponse(response)).toThrow('Failed to parse');
  });

  it('should handle JSON without code language specifier', () => {
    const response = `\`\`\`
{
  "translation": "测试",
  "phonetic": "/test/",
  "difficulty": "A2",
  "definition": "检查"
}
\`\`\``;

    const result = parseExplainWordResponse(response);

    expect(result.translation).toBe('测试');
  });
});

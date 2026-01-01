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
    expect(prompt).toContain('English word/phrase');
    expect(prompt).toContain('B2-level');
    expect(prompt).toContain('Simplified Chinese');
    expect(prompt).toContain('IPA phonetic notation');
    expect(prompt).toContain('"translation"');
    expect(prompt).toContain('"phonetic"');
    expect(prompt).toContain('"difficulty"');
    expect(prompt).toContain('"definition"');
    expect(prompt).toContain('"example"');
    expect(prompt).not.toContain('Context where the word appears');
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
    expect(prompt).toContain('Context where the word appears');
    expect(prompt).toContain('I walked along the river bank');
    expect(prompt).toContain('most relevant based on context');
  });

  it('should use correct phonetic instruction for English', () => {
    const options: ExplainWordPromptOptions = {
      word: 'example',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'B1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('IPA phonetic notation for the English word');
  });

  it('should use correct phonetic instruction for Chinese', () => {
    const options: ExplainWordPromptOptions = {
      word: '学习',
      sourceLang: 'zh',
      targetLang: 'en',
      userLevel: 'B1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('Pinyin with tone marks for the Chinese word');
  });

  it('should use correct phonetic instruction for Japanese', () => {
    const options: ExplainWordPromptOptions = {
      word: '勉強',
      sourceLang: 'ja',
      targetLang: 'en',
      userLevel: 'B1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('Romaji for the Japanese word');
  });

  it('should use correct phonetic instruction for Korean', () => {
    const options: ExplainWordPromptOptions = {
      word: '공부',
      sourceLang: 'ko',
      targetLang: 'en',
      userLevel: 'B1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('Romanization for the Korean word');
  });

  it('should use correct phonetic instruction for French', () => {
    const options: ExplainWordPromptOptions = {
      word: 'bonjour',
      sourceLang: 'fr',
      targetLang: 'en',
      userLevel: 'A1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('IPA phonetic notation for the French word');
  });

  it('should handle different user proficiency levels', () => {
    const options: ExplainWordPromptOptions = {
      word: 'test',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'C1',
    };

    const prompt = buildExplainWordPrompt(options);

    expect(prompt).toContain('C1-level');
    expect(prompt).toContain('adapted to C1 level');
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

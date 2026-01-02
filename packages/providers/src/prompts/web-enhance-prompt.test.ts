import { describe, it, expect } from 'vitest';
import {
  buildWebEnhancePrompt,
  parseWebEnhanceResponse,
  type WebEnhancePromptOptions,
} from '../prompts/web-enhance-prompt';

describe('buildWebEnhancePrompt', () => {
  it('should build prompt with single difficulty level', () => {
    const options: WebEnhancePromptOptions = {
      content: 'This is a test sentence with some vocabulary.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      difficultyMin: 'B1',
      difficultyMax: 'B1',
      maxWords: 10,
    };

    const prompt = buildWebEnhancePrompt(options);

    expect(prompt).toContain('CEFR');
    expect(prompt).toContain('B1');
    expect(prompt).toContain('英语');
    expect(prompt).toContain('简体中文');
    expect(prompt).toContain('最多 10');
    expect(prompt).toContain('This is a test sentence');
    expect(prompt).toContain('"content_result"');
    expect(prompt).toContain('"convert_word"');
  });

  it('should build prompt with difficulty range', () => {
    const options: WebEnhancePromptOptions = {
      content: 'Advanced technical documentation.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      difficultyMin: 'B2',
      difficultyMax: 'C2',
      maxWords: 15,
    };

    const prompt = buildWebEnhancePrompt(options);

    expect(prompt).toContain('CEFR');
    expect(prompt).toContain('B2-C2');
    expect(prompt).toContain('最多 15');
  });

  it('should use default maxWords when not provided', () => {
    const options: WebEnhancePromptOptions = {
      content: 'Test content',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      difficultyMin: 'B1',
      difficultyMax: 'B1',
    };

    const prompt = buildWebEnhancePrompt(options);

    expect(prompt).toContain('最多 15');
  });

  it('should handle different language pairs', () => {
    const options: WebEnhancePromptOptions = {
      content: 'Bonjour le monde',
      sourceLang: 'fr',
      targetLang: 'en',
      difficultyMin: 'A1',
      difficultyMax: 'A2',
    };

    const prompt = buildWebEnhancePrompt(options);

    expect(prompt).toContain('法语');
    expect(prompt).toContain('英语');
  });
});

describe('parseWebEnhanceResponse', () => {
  it('should parse plain JSON response', () => {
    const response = JSON.stringify({
      content_result: 'This is a test',
      convert_word: [
        { original: 'test', converted: '测试', difficulty: 'A2' },
      ],
    });

    const result = parseWebEnhanceResponse(response);

    expect(result.content_result).toBe('This is a test');
    expect(result.convert_word).toHaveLength(1);

    const firstWord = result.convert_word?.[0];
    expect(firstWord).toBeDefined();
    expect(firstWord?.original).toBe('test');
    expect(firstWord?.converted).toBe('测试');
    expect(firstWord?.difficulty).toBe('A2');
  });

  it('should parse JSON wrapped in markdown code block', () => {
    const response = `\`\`\`json
{
  "content_result": "Test content",
  "convert_word": [
    { "original": "example", "converted": "例子", "difficulty": "B1" }
  ]
}
\`\`\``;

    const result = parseWebEnhanceResponse(response);

    expect(result.content_result).toBe('Test content');
    expect(result.convert_word).toHaveLength(1);
  });

  it('should parse JSON without code language specifier', () => {
    const response = `\`\`\`
{
  "content_result": "Test",
  "convert_word": []
}
\`\`\``;

    const result = parseWebEnhanceResponse(response);

    expect(result.content_result).toBe('Test');
    expect(result.convert_word).toEqual([]);
  });

  it('should handle response with empty convert_word array', () => {
    const response = JSON.stringify({
      content_result: 'Simple text',
      convert_word: [],
    });

    const result = parseWebEnhanceResponse(response);

    expect(result.content_result).toBe('Simple text');
    expect(result.convert_word).toEqual([]);
  });

  it('should handle response without convert_word field', () => {
    const response = JSON.stringify({
      content_result: 'Simple text',
    });

    const result = parseWebEnhanceResponse(response);

    expect(result.content_result).toBe('Simple text');
    expect(result.convert_word).toBeUndefined();
  });

  it('should throw error for invalid JSON', () => {
    const response = 'not valid json';

    expect(() => parseWebEnhanceResponse(response)).toThrow('Failed to parse');
  });

  it('should handle words without difficulty field', () => {
    const response = JSON.stringify({
      content_result: 'Test',
      convert_word: [
        { original: 'word', converted: '词' },
      ],
    });

    const result = parseWebEnhanceResponse(response);

    const firstWord = result.convert_word?.[0];
    expect(firstWord).toBeDefined();
    expect(firstWord?.difficulty).toBeUndefined();
  });
});

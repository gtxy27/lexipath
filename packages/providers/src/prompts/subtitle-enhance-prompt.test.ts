import { describe, it, expect } from 'vitest';
import {
  buildSubtitleEnhancePrompt,
  parseSubtitleEnhanceResponse,
  type SubtitleEnhancePromptOptions,
} from '../prompts/subtitle-enhance-prompt';

describe('buildSubtitleEnhancePrompt', () => {
  it('should build prompt for single mode', () => {
    const options: SubtitleEnhancePromptOptions = {
      subtitle: 'This is a complex sentence with difficult vocabulary.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      difficultyLevel: 'B1',
      mode: 'single',
    };

    const prompt = buildSubtitleEnhancePrompt(options);

    expect(prompt).toContain('<用户信息>');
    expect(prompt).toContain('<用户输入>');
    expect(prompt).toContain('<输出格式>');
    expect(prompt).toContain('<输出说明>');
    expect(prompt).toContain('CEFR B1');
    expect(prompt).toContain('英语字幕');
    expect(prompt).toContain('This is a complex sentence');
    expect(prompt).toContain('"line1_final"');
    expect(prompt).not.toContain('"line2_final"');
    expect(prompt).toContain('只返回增强后的英语字幕内容');
    expect(prompt).toContain('输出约束');
  });

  it('should build prompt for bilingual mode', () => {
    const options: SubtitleEnhancePromptOptions = {
      subtitle: 'How are you doing today?',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      difficultyLevel: 'A2',
      mode: 'bilingual',
    };

    const prompt = buildSubtitleEnhancePrompt(options);

    expect(prompt).toContain('<输出说明>');
    expect(prompt).toContain('CEFR A2');
    expect(prompt).toContain('双语展示');
    expect(prompt).toContain('"line1_final"');
    expect(prompt).toContain('"line2_final"');
    expect(prompt).toContain('简体中文');
  });

  it('should handle different difficulty levels', () => {
    const options: SubtitleEnhancePromptOptions = {
      subtitle: 'Test subtitle',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      difficultyLevel: 'C2',
      mode: 'single',
    };

    const prompt = buildSubtitleEnhancePrompt(options);

    expect(prompt).toContain('CEFR C2');
  });

  it('should handle different language pairs', () => {
    const options: SubtitleEnhancePromptOptions = {
      subtitle: 'Bonjour, comment allez-vous?',
      sourceLang: 'fr',
      targetLang: 'en',
      difficultyLevel: 'B1',
      mode: 'bilingual',
    };

    const prompt = buildSubtitleEnhancePrompt(options);

    expect(prompt).toContain('法语字幕');
    expect(prompt).toContain('英语');
  });

  it('should include subtitle length constraints', () => {
    const options: SubtitleEnhancePromptOptions = {
      subtitle: 'Test',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      difficultyLevel: 'B1',
      mode: 'single',
    };

    const prompt = buildSubtitleEnhancePrompt(options);

    expect(prompt).toContain('40 个字符');
  });
});

describe('parseSubtitleEnhanceResponse', () => {
  it('should parse single mode response', () => {
    const response = JSON.stringify({
      line1_final: 'This is the enhanced subtitle',
    });

    const result = parseSubtitleEnhanceResponse(response);

    expect(result.line1_final).toBe('This is the enhanced subtitle');
    expect(result.line2_final).toBeUndefined();
  });

  it('should parse bilingual mode response', () => {
    const response = JSON.stringify({
      line1_final: 'Enhanced English subtitle',
      line2_final: '增强的英文字幕',
    });

    const result = parseSubtitleEnhanceResponse(response);

    expect(result.line1_final).toBe('Enhanced English subtitle');
    expect(result.line2_final).toBe('增强的英文字幕');
  });

  it('should parse JSON wrapped in markdown code block', () => {
    const response = `\`\`\`json
{
  "line1_final": "Test subtitle",
  "line2_final": "测试字幕"
}
\`\`\``;

    const result = parseSubtitleEnhanceResponse(response);

    expect(result.line1_final).toBe('Test subtitle');
    expect(result.line2_final).toBe('测试字幕');
  });

  it('should parse response with three lines', () => {
    const response = JSON.stringify({
      line1_final: 'Line 1',
      line2_final: 'Line 2',
      line3_final: 'Line 3',
    });

    const result = parseSubtitleEnhanceResponse(response);

    expect(result.line1_final).toBe('Line 1');
    expect(result.line2_final).toBe('Line 2');
    expect(result.line3_final).toBe('Line 3');
  });

  it('should throw error if line1_final is missing', () => {
    const response = JSON.stringify({
      line2_final: 'Only second line',
    });

    expect(() => parseSubtitleEnhanceResponse(response)).toThrow('Missing required field: line1_final');
  });

  it('should throw error for invalid JSON', () => {
    const response = 'not valid json';

    expect(() => parseSubtitleEnhanceResponse(response)).toThrow('Failed to parse');
  });

  it('should handle JSON without code language specifier', () => {
    const response = `\`\`\`
{
  "line1_final": "Test"
}
\`\`\``;

    const result = parseSubtitleEnhanceResponse(response);

    expect(result.line1_final).toBe('Test');
  });
});

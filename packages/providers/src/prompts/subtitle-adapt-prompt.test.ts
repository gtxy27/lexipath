import { describe, expect, it } from 'vitest';
import { buildSubtitleAdaptPrompt } from './subtitle-adapt-prompt';

describe('buildSubtitleAdaptPrompt', () => {
  it('includes language info and subtitle text', () => {
    const prompt = buildSubtitleAdaptPrompt({
      subtitle: '你好，欢迎回来。',
      sourceLang: 'zh',
      targetLang: 'en',
      motherTongue: 'zh-CN',
      difficultyLevel: 'B1',
    });

    expect(prompt).toContain('中文');
    expect(prompt).toContain('英语');
    expect(prompt).toContain('B1');
    expect(prompt).toContain('你好');
    expect(prompt).toContain('输出约束');
  });
});

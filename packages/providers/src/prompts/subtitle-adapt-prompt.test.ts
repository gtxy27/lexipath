import { describe, expect, it } from 'vitest';
import { BEHAVIORS, resolvePromptScene, resolvePromptStyleValue } from '@lexipath/core';
import { buildSubtitleAdaptPrompt } from './subtitle-adapt-prompt';

describe('buildSubtitleAdaptPrompt', () => {
  it('includes language info and subtitle text', () => {
    const prompt = buildSubtitleAdaptPrompt({
      subtitle: '你好，欢迎回来。',
      sourceLang: 'zh',
      targetLang: 'en',
      difficultyLevel: 'B1',
      sceneValue: resolvePromptScene('video_subtitle'),
      styleValue: resolvePromptStyleValue('default'),
      userInfo: { motherTongue: 'zh-CN', targetLearningLanguage: 'en', cefrLevel: 'B1' },
      behavior: BEHAVIORS.subtitle_adapt,
    });

    expect(prompt).toContain('中文');
    expect(prompt).toContain('英语');
    expect(prompt).toContain('B1');
    expect(prompt).toContain('你好');
    expect(prompt).toContain('输出约束');
  });
});

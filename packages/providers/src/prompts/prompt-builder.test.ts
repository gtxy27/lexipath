import { describe, expect, it } from 'vitest';
import { SettingsSchema, resolvePromptStyleValue } from '@lexipath/core';
import { PromptBuilder } from './prompt-builder';

describe('PromptBuilder', () => {
  it('uses Settings.promptStyle by default', async () => {
    const settings = SettingsSchema.parse({ promptStyle: 'anime' });
    const builder = new PromptBuilder({ getSettings: async () => settings });

    const prompt = await builder.buildEnglishCorrectionPrompt({ text: 'I have went to the store yesterday.' });
    expect(prompt).toContain(resolvePromptStyleValue('anime'));
  });

  it('allows explicit style override per call', async () => {
    const settings = SettingsSchema.parse({ promptStyle: 'anime' });
    const builder = new PromptBuilder({ getSettings: async () => settings });

    const prompt = await builder.buildEnglishCorrectionPrompt({
      text: 'I have went to the store yesterday.',
      styleKey: 'academic',
    });
    expect(prompt).toContain(resolvePromptStyleValue('academic'));
  });

  it('selects keyword-select scene by options.scene', async () => {
    const settings = SettingsSchema.parse({ promptStyle: 'default' });
    const builder = new PromptBuilder({ getSettings: async () => settings });

    const webPrompt = await builder.buildKeywordSelectPrompt({
      text: 'This is a short article about machine learning.',
      sourceLang: 'en',
      targetLang: 'zh-CN',
      userLevel: 'B1',
      scene: 'web',
    });
    expect(webPrompt).toContain('网页文本关键词提取场景');
  });
});


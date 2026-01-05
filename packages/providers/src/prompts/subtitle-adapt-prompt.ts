import type { CEFRLevel, ProficiencyPreference, SupportedLanguage, PromptTemplateInput } from '@lexipath/core';
import { buildCefrOutputGuidance } from './cefr-guidance';
import { buildProficiencyReferenceLine } from './proficiency-reference';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface SubtitleAdaptPromptOptions {
  subtitle: string;
  sourceLang: SupportedLanguage;
  targetLang: SupportedLanguage;
  difficultyLevel: CEFRLevel;
  proficiencyPreference?: ProficiencyPreference;
}

export function buildSubtitleAdaptPrompt(options: SubtitleAdaptPromptOptions): string {
  const subtitle = options.subtitle.trim();
  const sourceName = getLanguageName(options.sourceLang);
  const targetName = getLanguageName(options.targetLang);
  const cefrGuidance = buildCefrOutputGuidance({
    sourceLang: options.sourceLang,
    targetLang: options.targetLang,
    level: options.difficultyLevel,
  });
  const referenceLine = buildProficiencyReferenceLine({
    sourceLang: options.sourceLang,
    targetLang: 'zh-CN',
    userLevel: options.difficultyLevel,
    ...(options.proficiencyPreference
      ? { proficiencyPreference: options.proficiencyPreference }
      : {}),
  });

  const template: PromptTemplateInput = {
    role: '你是字幕学习翻译助手。',
    scene: '当前环境：视频字幕学习场景。',
    style: '风格：自然清晰、适合字幕显示；不要添加原文没有的信息。',
    task: `任务：将<用户输入>中的${sourceName}字幕翻译为${targetName}，并将表达难度调整到 CEFR ${options.difficultyLevel} 水平；保持核心含义不变；字幕长度合理（最多 2 行，每行约 40 个字符以内）。`,
    userInfo: {
      motherTongue: options.targetLang,
      targetLearningLanguage: options.sourceLang,
      cefrLevel: options.difficultyLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    },
    userInput: subtitle,
    outputFormat: `{
  "line1_final": ""
}`,
    outputNotes: [
      cefrGuidance,
      '',
      '规则：',
      '1. 保持核心含义不变',
      `2. 输出必须是${targetName}`,
      `3. 难度适配 CEFR ${options.difficultyLevel}（词汇与句式尽量符合该水平）`,
      '4. 字幕长度合理（最多 2 行，每行约 40 个字符以内）',
      '5. 只输出一个 JSON 对象；不要 Markdown、不要代码块、不要任何额外文字',
    ].join('\n'),
  };

  return renderPromptTemplate(template);
}

function getLanguageName(lang: SupportedLanguage): string {
  const names: Record<SupportedLanguage, string> = {
    en: '英语',
    ja: '日语',
    ko: '韩语',
    fr: '法语',
    de: '德语',
    zh: '中文',
  };
  return names[lang] || lang;
}

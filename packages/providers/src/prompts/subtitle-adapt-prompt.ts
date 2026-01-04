import type { CEFRLevel, SupportedLanguage } from '@lexipath/core';

export interface SubtitleAdaptPromptOptions {
  subtitle: string;
  sourceLang: SupportedLanguage;
  targetLang: SupportedLanguage;
  difficultyLevel: CEFRLevel;
}

export function buildSubtitleAdaptPrompt(options: SubtitleAdaptPromptOptions): string {
  const subtitle = options.subtitle.trim();
  const sourceName = getLanguageName(options.sourceLang);
  const targetName = getLanguageName(options.targetLang);

  return `你是字幕学习翻译助手，服务于语言学习者。请将下面的 ${sourceName} 字幕翻译为 ${targetName}，并将 ${targetName} 的难度调整到 CEFR ${options.difficultyLevel} 水平，同时保持口语自然、适合字幕显示。

规则：
1. 保持核心含义不变
2. 输出必须是 ${targetName}
3. 难度适配 CEFR ${options.difficultyLevel}（词汇与句式尽量符合该水平）
4. 字幕长度合理（最多 2 行，每行约 40 个字符以内）
5. 只输出 JSON，不要 Markdown，不要代码块，不要任何额外文字

待处理字幕：
"""
${subtitle}
"""

请输出 JSON：
{
  "line1_final": "${targetName} 字幕"
}`;
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


import type { CEFRLevel, NativeLanguage, SupportedLanguage } from '@lexipath/core';

type GuidanceOptions = {
  targetLang: NativeLanguage | SupportedLanguage;
  sourceLang: SupportedLanguage;
  level: CEFRLevel;
};

function isChinese(lang: NativeLanguage | SupportedLanguage): boolean {
  return lang === 'zh' || lang === 'zh-CN' || lang === 'zh-TW';
}

export function buildCefrOutputGuidance(options: GuidanceOptions): string {
  const target = isChinese(options.targetLang) ? '中文' : '目标语言';

  // Keep this short: it is appended to multiple prompts.
  // Provide quantitative constraints mainly via sentence/length limits.
  switch (options.level) {
    case 'A1':
      return [
        `CEFR ${options.level} 输出约束：`,
        `- 用${target}写得非常简单：尽量 1 句讲清楚，避免长从句/抽象术语。`,
        `- 定义尽量 ≤ 18 个汉字或 ≤ 10 个英文词（大概）。`,
        `- 如必须用更难词：最多 1 个，并用括号补一句更简单的解释。`,
      ].join('\n');
    case 'A2':
      return [
        `CEFR ${options.level} 输出约束：`,
        `- 用${target}写得简单清晰：尽量 1–2 句，避免生僻词/学术表达。`,
        `- 定义尽量 ≤ 26 个汉字或 ≤ 14 个英文词（大概）。`,
        `- 如必须用更难词：最多 1 个，并补一句白话解释。`,
      ].join('\n');
    case 'B1':
      return [
        `CEFR ${options.level} 输出约束：`,
        `- 用${target}写得日常、直接：2 句内讲清核心含义。`,
        `- 定义尽量 ≤ 36 个汉字或 ≤ 20 个英文词（大概）。`,
        `- 允许少量 i+1：最多 1–2 个略难词，但必须顺带解释。`,
      ].join('\n');
    case 'B2':
      return [
        `CEFR ${options.level} 输出约束：`,
        `- 用${target}写得准确自然：可补充 1 个常见搭配/用法提示。`,
        `- 定义尽量 ≤ 50 个汉字或 ≤ 28 个英文词（大概）。`,
        `- 避免专业术语；如遇专业语境，优先给通俗释义。`,
      ].join('\n');
    case 'C1':
      return [
        `CEFR ${options.level} 输出约束：`,
        `- 用${target}写得更精确：可点出语气/语域差别或常见误用。`,
        `- 定义尽量 ≤ 70 个汉字或 ≤ 38 个英文词（大概）。`,
        `- 如有多义：优先语境义，并可补一句次要义。`,
      ].join('\n');
    case 'C2':
      return [
        `CEFR ${options.level} 输出约束：`,
        `- 用${target}写得专业且细腻：可给细微区别、语体、习惯搭配。`,
        `- 定义尽量 ≤ 90 个汉字或 ≤ 50 个英文词（大概）。`,
        `- 保持简洁，不要长篇论文式解释。`,
      ].join('\n');
    default:
      return `CEFR ${options.level} 输出约束：用目标语言保持难度匹配并尽量简洁。`;
  }
}

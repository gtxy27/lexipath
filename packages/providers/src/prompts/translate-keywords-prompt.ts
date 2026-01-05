import type {
  CEFRLevel,
  ProficiencyPreference,
  PromptTemplateInput,
  SupportedLanguage,
  NativeLanguage,
} from '@lexipath/core';
import { buildProficiencyReferenceLine } from './proficiency-reference';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface TranslateKeywordsPromptOptions {
  keywords: string[];
  context?: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  userLevel: CEFRLevel;
  proficiencyPreference?: ProficiencyPreference;
}

export function buildTranslateKeywordsPrompt(options: TranslateKeywordsPromptOptions): string {
  const keywords = options.keywords.map((term) => term.trim()).filter(Boolean);
  const context = options.context?.trim();

  const referenceLine = buildProficiencyReferenceLine({
    sourceLang: options.sourceLang,
    targetLang: options.targetLang,
    userLevel: options.userLevel,
    ...(options.proficiencyPreference ? { proficiencyPreference: options.proficiencyPreference } : {}),
  });

  const userInput = [
    '词汇列表（每行一个）：',
    keywords.join('\n'),
    ...(context ? ['', '上下文：', context] : []),
  ].join('\n');

  const template: PromptTemplateInput = {
    role: '你是专业翻译助手。',
    scene: '当前环境：词汇列表翻译场景。',
    style: '风格：只给出最常见、最基础的译法；不输出多义列表。',
    task: `任务：将<用户输入>中的词汇列表从 ${options.sourceLang} 翻译为 ${options.targetLang}。`,
    userInfo: {
      motherTongue: options.targetLang,
      targetLearningLanguage: options.sourceLang,
      cefrLevel: options.userLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    },
    userInput,
    outputFormat: `translation_1
translation_2`,
    outputNotes: [
      '规则（非常重要）：',
      '1. 严格按输入顺序输出',
      '2. 每行只输出一个翻译结果',
      '3. 不要输出序号、项目符号、解释、JSON、Markdown 或代码块',
      '4. 只输出最常见、最基础的译法（不要多个释义）',
      ...(context ? ['5. 如提供上下文，请结合上下文选择最合适的译法'] : []),
    ].join('\n'),
  };

  return renderPromptTemplate(template);
}

function stripCodeFences(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, ''))
    .trim();
}

function normalizeLine(line: string): string {
  let value = line.trim();
  if (!value) return '';

  value = value.replace(/^\d+[.)]\s*/, '').replace(/^[-*]\s*/, '').trim();

  const colonIndex = Math.max(value.lastIndexOf(':'), value.lastIndexOf('：'));
  if (colonIndex > 0) {
    const after = value.slice(colonIndex + 1).trim();
    if (after) value = after;
  }

  return value.trim();
}

export function parseTranslateKeywordsResponse(
  response: string,
  expectedCount?: number
): { translations: string[]; ok: boolean } {
  const cleaned = stripCodeFences(response);
  if (!cleaned) return { translations: [], ok: false };

  const translations = cleaned
    .replace(/\r/g, '')
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean);

  if (typeof expectedCount === 'number' && Number.isFinite(expectedCount) && expectedCount >= 0) {
    return { translations, ok: translations.length === expectedCount };
  }

  return { translations, ok: translations.length > 0 };
}

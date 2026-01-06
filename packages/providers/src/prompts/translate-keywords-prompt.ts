import { BEHAVIORS, type CEFRLevel, type NativeLanguage, type PromptTemplateInput, type PromptUserInfo, type SupportedLanguage } from '@lexipath/core';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface TranslateKeywordsPromptOptions {
  keywords: string[];
  context?: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  userLevel: CEFRLevel;
  sceneValue: string;
  styleValue: string;
  userInfo: PromptUserInfo;
  behavior: typeof BEHAVIORS.translate_keywords;
}

export function buildTranslateKeywordsPrompt(options: TranslateKeywordsPromptOptions): string {
  const keywords = options.keywords.map((term) => term.trim()).filter(Boolean);
  const context = options.context?.trim();

  const userInput = [
    '词汇列表（每行一个）：',
    keywords.join('\n'),
    ...(context ? ['', '上下文：', context] : []),
  ].join('\n');

  const template: PromptTemplateInput = {
    role: options.behavior.role,
    scene: options.sceneValue,
    style: options.styleValue,
    task: options.behavior.task({ sourceLang: options.sourceLang, targetLang: options.targetLang }),
    userInfo: options.userInfo,
    userInput,
    outputFormat: options.behavior.outputFormat({ sourceLang: options.sourceLang, targetLang: options.targetLang, hasContext: Boolean(context) }),
    outputNotes: options.behavior.outputNotes({ hasContext: Boolean(context) }),
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

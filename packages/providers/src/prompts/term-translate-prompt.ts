import type {
  CEFRLevel,
  ProficiencyPreference,
  PromptTemplateInput,
  SupportedLanguage,
  NativeLanguage,
} from '@lexipath/core';
import { buildProficiencyReferenceLine } from './proficiency-reference';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface TermTranslatePromptOptions {
  terms: string[];
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  userLevel: CEFRLevel;
  proficiencyPreference?: ProficiencyPreference;
}

export function buildTermTranslatePrompt(options: TermTranslatePromptOptions): string {
  const terms = options.terms.map((term) => term.trim()).filter(Boolean);

  const referenceLine = buildProficiencyReferenceLine({
    sourceLang: options.sourceLang,
    targetLang: options.targetLang,
    userLevel: options.userLevel,
    ...(options.proficiencyPreference ? { proficiencyPreference: options.proficiencyPreference } : {}),
  });

  const userInput = terms.join('\n');

  const template: PromptTemplateInput = {
    role: '你是翻译助手。',
    scene: '当前环境：术语列表翻译场景。',
    style: '风格：稳定一致，不输出多义列表，不添加或删除术语。',
    task: `任务：把<用户输入>中的术语从${options.sourceLang}翻译为${options.targetLang}，输出一个 JSON 对象：key 为原术语（与输入完全一致），value 为翻译结果。`,
    userInfo: {
      motherTongue: options.targetLang,
      targetLearningLanguage: options.sourceLang,
      cefrLevel: options.userLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    },
    userInput,
    outputFormat: `{
  "term": "translation"
}`,
    outputNotes: [
      '规则（非常重要）：',
      '1. 只输出一个 JSON 对象；不要 Markdown、不要代码块、不要任何额外文字',
      '2. key 必须与输入术语完全一致；value 为翻译结果',
      '3. 不要添加或删除术语；必须对每个术语给出一个翻译',
    ].join('\n'),
  };

  return renderPromptTemplate(template);
}

function stripCodeFences(input: string): string {
  return input
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  const end = text.lastIndexOf('}');
  if (end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function parseTranslationObject(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const maybeWrapped = record.translations;
  const target = maybeWrapped && typeof maybeWrapped === 'object' ? (maybeWrapped as Record<string, unknown>) : record;

  const translations: Record<string, string> = {};
  for (const [key, value] of Object.entries(target)) {
    if (typeof value !== 'string') continue;
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    translations[normalizedKey] = value;
  }
  return Object.keys(translations).length ? translations : null;
}

export function parseTermTranslateResponse(response: string): { translations: Record<string, string>; ok: boolean } {
  const cleaned = stripCodeFences(response);
  if (!cleaned) return { translations: {}, ok: false };

  const candidates = [cleaned, extractFirstJsonObject(cleaned)].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const translations = parseTranslationObject(parsed);
      if (translations) return { translations, ok: true };
    } catch {
      // continue
    }
  }

  return { translations: {}, ok: false };
}

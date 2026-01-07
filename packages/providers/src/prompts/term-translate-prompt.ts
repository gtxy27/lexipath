import { BEHAVIORS, type CEFRLevel, type NativeLanguage, type PromptTemplateInput, type PromptUserInfo, type SupportedLanguage } from '@lexipath/core';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface TermTranslatePromptOptions {
  terms: string[];
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  userLevel: CEFRLevel;
  sceneValue: string;
  styleValue: string;
  userInfo: PromptUserInfo;
  behavior: typeof BEHAVIORS.term_translate;
}

export function buildTermTranslatePrompt(options: TermTranslatePromptOptions): string {
  const terms = options.terms.map((term) => term.trim()).filter(Boolean);

  const userInput = terms.join('\n');

  const template: PromptTemplateInput = {
    role: options.behavior.role,
    scene: options.sceneValue,
    style: options.styleValue,
    task: options.behavior.task({ sourceLang: options.sourceLang, targetLang: options.targetLang }),
    userInfo: options.userInfo,
    userInput,
    outputFormat: options.behavior.outputFormat({ sourceLang: options.sourceLang, targetLang: options.targetLang }),
    outputNotes: options.behavior.outputNotes(),
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
    } catch (error: unknown) {
      // ignore parse error; try next candidate
    }
  }

  return { translations: {}, ok: false };
}

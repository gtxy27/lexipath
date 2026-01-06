import { BEHAVIORS, type CEFRLevel, type NativeLanguage, type PromptTemplateInput, type PromptUserInfo, type SupportedLanguage } from '@lexipath/core';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface KeywordSelectPromptOptions {
  text: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  userLevel: CEFRLevel;
  sceneValue: string;
  styleValue: string;
  userInfo: PromptUserInfo;
  behavior: typeof BEHAVIORS.keyword_select;
}

export function buildKeywordSelectPrompt(options: KeywordSelectPromptOptions): string {
  const text = options.text.trim();

  const template: PromptTemplateInput = {
    role: options.behavior.role,
    scene: options.sceneValue,
    style: options.styleValue,
    task: options.behavior.task({ userLevel: options.userLevel }),
    userInfo: options.userInfo,
    userInput: text,
    outputFormat: options.behavior.outputFormat({ userLevel: options.userLevel }),
    outputNotes: options.behavior.outputNotes({ userLevel: options.userLevel }),
  };

  return renderPromptTemplate(template);
}

function stripCodeFences(input: string): string {
  return input
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

function tryParseJsonArray(input: string): string[] | null {
  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) return null;
    const strings = parsed.filter((item) => typeof item === 'string') as string[];
    return strings;
  } catch {
    return null;
  }
}

function extractFirstJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;
  const end = text.lastIndexOf(']');
  if (end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizeKeyword(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function parseKeywordSelectResponse(response: string): { keywords: string[]; ok: boolean } {
  const cleaned = stripCodeFences(response);
  if (!cleaned) return { keywords: [], ok: false };

  const direct = tryParseJsonArray(cleaned);
  const parsed = direct ?? ((): string[] | null => {
    const extracted = extractFirstJsonArray(cleaned);
    if (!extracted) return null;
    return tryParseJsonArray(extracted);
  })();

  if (!parsed) return { keywords: [], ok: false };

  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const item of parsed) {
    const normalized = normalizeKeyword(item);
    if (!normalized) continue;
    if (normalized.length > 120) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(normalized);
  }

  return { keywords, ok: true };
}

import type { CEFRLevel, Settings } from '@lexipath/core';
import { resolvePromptStyleKey, type PromptContextInfo, type PromptUserInfo } from '@lexipath/core/prompting';

const CEFR_ORDER: readonly CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export function nextCefrLevel(level: CEFRLevel): CEFRLevel {
  const idx = CEFR_ORDER.indexOf(level);
  if (idx < 0) return level;
  return CEFR_ORDER[Math.min(CEFR_ORDER.length - 1, idx + 1)] ?? level;
}

export function pickStyleKey(explicit: unknown, fallback: Settings['promptStyle']): string {
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) {
    return resolvePromptStyleKey(explicit);
  }
  if (fallback) return fallback;
  return 'default';
}

export function makePromptUserInfo(options: {
  motherTongue: string;
  targetLearningLanguage: string;
  cefrLevel: CEFRLevel;
  levelReferenceLine?: string;
}): PromptUserInfo {
  return {
    motherTongue: options.motherTongue,
    targetLearningLanguage: options.targetLearningLanguage,
    cefrLevel: options.cefrLevel,
    ...(options.levelReferenceLine ? { levelReferenceLine: options.levelReferenceLine } : {}),
  };
}

export function makeContextInfoFromText(text: string): PromptContextInfo {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return { before: lines, after: [] };
}

import type { WordFamiliarity } from '../types';

export const DEFAULT_FAMILIARITY = 0;
export const LEARNED_FAMILIARITY = 100;
export const FAVORITED_MIN_FAMILIARITY = 30;

function clampFamiliarity(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FAMILIARITY;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

export function normalizeWordForFamiliarity(word: string): string {
  return word.trim().toLowerCase();
}

export function createInitialWordFamiliarity(word: string, now = Date.now()): WordFamiliarity {
  const normalized = normalizeWordForFamiliarity(word);
  return {
    word: normalized,
    familiarity: DEFAULT_FAMILIARITY,
    lastSeen: now,
    encounters: 0,
  };
}

export function recordWordEncounter(
  record: WordFamiliarity,
  now = Date.now(),
): WordFamiliarity {
  return {
    ...record,
    word: normalizeWordForFamiliarity(record.word),
    lastSeen: now,
    encounters: Math.max(0, (record.encounters ?? 0) + 1),
    familiarity: clampFamiliarity(record.familiarity),
  };
}

export function setWordFamiliarity(
  record: WordFamiliarity,
  familiarity: number,
  now = Date.now(),
): WordFamiliarity {
  return {
    ...record,
    word: normalizeWordForFamiliarity(record.word),
    lastSeen: now,
    encounters: Math.max(0, record.encounters ?? 0),
    familiarity: clampFamiliarity(familiarity),
  };
}

export function recordWordFavorited(record: WordFamiliarity, now = Date.now()): WordFamiliarity {
  return setWordFamiliarity(
    record,
    Math.max(clampFamiliarity(record.familiarity), FAVORITED_MIN_FAMILIARITY),
    now,
  );
}

export function recordWordLearned(record: WordFamiliarity, now = Date.now()): WordFamiliarity {
  return setWordFamiliarity(record, LEARNED_FAMILIARITY, now);
}


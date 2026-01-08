import type { WordFamiliarity } from '../types';

export const DEFAULT_FAMILIARITY = 0;
export const LEARNED_FAMILIARITY = 100;
export const FAVORITED_MIN_FAMILIARITY = 30;

// Ebbinghaus forgetting curve parameters
const HALF_LIFE_DAYS = 7; // Memory half-life in days
const BASE_INCREMENT = 15; // Base familiarity increase per encounter
const DIMINISHING_FACTOR = 0.1; // How quickly increments diminish with encounters

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
  // Calculate time-based decay using Ebbinghaus forgetting curve
  const daysSinceLastSeen = (now - record.lastSeen) / (1000 * 60 * 60 * 24);
  
  // Exponential decay: R = e^(-t/S) where S is the half-life
  const decayFactor = Math.exp(-daysSinceLastSeen / HALF_LIFE_DAYS);
  const decayedFamiliarity = record.familiarity * decayFactor;
  
  // Learning increment with diminishing returns
  // As encounters increase, the increment decreases (spaced repetition effect)
  const encounters = Math.max(0, (record.encounters ?? 0));
  const increment = BASE_INCREMENT / (1 + encounters * DIMINISHING_FACTOR);
  
  // New familiarity = decayed value + learning increment
  const newFamiliarity = Math.min(100, decayedFamiliarity + increment);
  
  return {
    ...record,
    word: normalizeWordForFamiliarity(record.word),
    lastSeen: now,
    encounters: encounters + 1,
    familiarity: clampFamiliarity(newFamiliarity),
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


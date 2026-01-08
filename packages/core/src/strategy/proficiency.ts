import type {
  CEFRLevel,
  JLPTLevel,
  ProficiencyScore,
  TOPIKLevel,
} from '../types';

// Pre-computed lookup tables for O(1) conversion
const CEFR_TO_SCORE: Record<CEFRLevel, ProficiencyScore> = {
  A1: 1,
  A2: 3,
  B1: 5,
  B2: 7,
  C1: 9,
  C2: 10,
};

const JLPT_TO_SCORE: Record<JLPTLevel, ProficiencyScore> = {
  N5: 1,
  N4: 3,
  N3: 5,
  N2: 7,
  N1: 10,
};

const TOPIK_TO_SCORE: Record<TOPIKLevel, ProficiencyScore> = {
  '1': 1,
  '2': 3,
  '3': 5,
  '4': 7,
  '5': 9,
  '6': 10,
};

export function cefrToProficiencyScore(level: CEFRLevel): ProficiencyScore {
  const score = CEFR_TO_SCORE[level];
  if (score === undefined) throw new Error(`Unknown CEFR level: ${level}`);
  return score;
}

export function jlptToProficiencyScore(level: JLPTLevel): ProficiencyScore {
  const score = JLPT_TO_SCORE[level];
  if (score === undefined) throw new Error(`Unknown JLPT level: ${level}`);
  return score;
}

export function topikToProficiencyScore(level: TOPIKLevel): ProficiencyScore {
  const score = TOPIK_TO_SCORE[level];
  if (score === undefined) throw new Error(`Unknown TOPIK level: ${level}`);
  return score;
}


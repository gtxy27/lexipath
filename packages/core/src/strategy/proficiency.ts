import type {
  CEFRLevel,
  JLPTLevel,
  ProficiencyScore,
  TOPIKLevel,
} from '../types';

function ordinalToProficiencyScore(
  ordinal: number,
  maxOrdinal: number,
): ProficiencyScore {
  if (!Number.isFinite(ordinal) || !Number.isFinite(maxOrdinal)) {
    throw new Error('Invalid ordinal inputs');
  }
  if (maxOrdinal < 2) {
    throw new Error('maxOrdinal must be >= 2');
  }
  if (ordinal < 1 || ordinal > maxOrdinal) {
    throw new Error('ordinal out of range');
  }

  const normalized = (ordinal - 1) / (maxOrdinal - 1); // 0..1
  const score = Math.round(normalized * 9) + 1; // 1..10

  return score as ProficiencyScore;
}

const CEFR_ORDER: readonly CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const JLPT_ORDER: readonly JLPTLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1'];
const TOPIK_ORDER: readonly TOPIKLevel[] = ['1', '2', '3', '4', '5', '6'];

export function cefrToProficiencyScore(level: CEFRLevel): ProficiencyScore {
  const index = CEFR_ORDER.indexOf(level);
  if (index < 0) throw new Error(`Unknown CEFR level: ${level}`);
  return ordinalToProficiencyScore(index + 1, CEFR_ORDER.length);
}

export function jlptToProficiencyScore(level: JLPTLevel): ProficiencyScore {
  const index = JLPT_ORDER.indexOf(level);
  if (index < 0) throw new Error(`Unknown JLPT level: ${level}`);
  return ordinalToProficiencyScore(index + 1, JLPT_ORDER.length);
}

export function topikToProficiencyScore(level: TOPIKLevel): ProficiencyScore {
  const index = TOPIK_ORDER.indexOf(level);
  if (index < 0) throw new Error(`Unknown TOPIK level: ${level}`);
  return ordinalToProficiencyScore(index + 1, TOPIK_ORDER.length);
}


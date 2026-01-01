import type { CEFRLevel, ProficiencyScore, Tier } from '../types';
import { cefrToProficiencyScore } from './proficiency';

export function proficiencyScoreToTier(score: ProficiencyScore): Tier {
  if (score <= 3) return 'easy';
  if (score <= 7) return 'medium';
  return 'hard';
}

export function cefrToTier(proficiencyLevel: CEFRLevel): Tier {
  return proficiencyScoreToTier(cefrToProficiencyScore(proficiencyLevel));
}


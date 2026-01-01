import type { CEFRLevel, StrategyOutput } from '../types';
import type { WordFamiliarityByWord } from './master-words';
import { buildMasterWords } from './master-words';
import { cefrToTier } from './tier';

export function calculateIPlusOneStrategy(params: {
  proficiencyLevel: CEFRLevel;
  words: readonly string[];
  familiarityByWord?: WordFamiliarityByWord;
  familiarityThreshold?: number;
}): StrategyOutput {
  const tier = cefrToTier(params.proficiencyLevel);
  const masterWords = buildMasterWords(
    params.words,
    params.familiarityByWord ?? {},
    {
      ...(params.familiarityThreshold !== undefined && {
        familiarityThreshold: params.familiarityThreshold,
      }),
    },
  );

  return { tier, masterWords };
}

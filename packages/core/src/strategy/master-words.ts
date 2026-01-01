import type { MasterWords } from '../types';

export type WordFamiliarityByWord = Readonly<Record<string, number | undefined>>;

export const DEFAULT_FAMILIARITY_THRESHOLD = 70;

function normalizeWord(word: string): string {
  return word.trim().toLowerCase();
}

export function buildMasterWords(
  words: readonly string[],
  familiarityByWord: WordFamiliarityByWord,
  options?: { familiarityThreshold?: number },
): MasterWords {
  const familiarityThreshold =
    options?.familiarityThreshold ?? DEFAULT_FAMILIARITY_THRESHOLD;

  const familiar: string[] = [];
  const unfamiliar: string[] = [];
  const seen = new Set<string>();

  for (const rawWord of words) {
    const word = normalizeWord(rawWord);
    if (!word) continue;
    if (seen.has(word)) continue;
    seen.add(word);

    const rawFamiliarity = familiarityByWord[word];
    const familiarity =
      typeof rawFamiliarity === 'number' && Number.isFinite(rawFamiliarity)
        ? rawFamiliarity
        : 0;

    if (familiarity >= familiarityThreshold) familiar.push(word);
    else unfamiliar.push(word);
  }

  return { familiar, unfamiliar };
}

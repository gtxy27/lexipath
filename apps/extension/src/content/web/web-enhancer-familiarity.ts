import type { WordFamiliarity } from "@lexipath/core";

export type WordFamiliarityLite = { familiarity: number; encounters: number };

export type FamiliarityTracker = Readonly<{
  getFamiliarityForWords: (words: string[]) => Promise<Record<string, WordFamiliarityLite>>;
  updateForgottenWordsForPage: (surfaceWords: string[], familiarityByWord: Record<string, WordFamiliarityLite>) => void;
  resetPageTracking: () => void;
}>;

export function createFamiliarityTracker(options: {
  normalizeWordKey: (raw: string) => string;
  sendMessage: (type: "BATCH_GET_WORD_FAMILIARITY", payload: { words: string[] }) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>;
  emitContext: (update: { forgottenWords: Array<{ word: string; familiarity: number; encounters: number }> }) => void;
  thresholds: { minEncounters: number; maxFamiliarity: number };
}): FamiliarityTracker {
  const wordFamiliarityCache = new Map<string, WordFamiliarityLite>();
  const pageForgottenWords = new Map<string, { word: string; familiarity: number; encounters: number }>();

  const getFamiliarityForWords = async (words: string[]): Promise<Record<string, WordFamiliarityLite>> => {
    const normalized = Array.from(new Set(words.map(options.normalizeWordKey).filter(Boolean)));
    if (normalized.length === 0) return {};

    const missing = normalized.filter((w) => !wordFamiliarityCache.has(w));
    if (missing.length > 0) {
      const response = await options.sendMessage("BATCH_GET_WORD_FAMILIARITY", { words: missing });
      if (response.ok) {
        const seen = new Set<string>();
        for (const record of response.value as WordFamiliarity[]) {
          const key = options.normalizeWordKey(record.word);
          if (!key) continue;
          seen.add(key);
          wordFamiliarityCache.set(key, {
            familiarity: record.familiarity ?? 0,
            encounters: record.encounters ?? 0,
          });
        }
        for (const key of missing) {
          if (seen.has(options.normalizeWordKey(key))) continue;
          wordFamiliarityCache.set(key, { familiarity: 0, encounters: 0 });
        }
      } else {
        for (const key of missing) {
          wordFamiliarityCache.set(key, { familiarity: 0, encounters: 0 });
        }
      }
    }

    const out: Record<string, WordFamiliarityLite> = {};
    for (const key of normalized) {
      out[key] = wordFamiliarityCache.get(key) ?? { familiarity: 0, encounters: 0 };
    }
    return out;
  };

  const updateForgottenWordsForPage = (surfaceWords: string[], familiarityByWord: Record<string, WordFamiliarityLite>) => {
    let changed = false;
    for (const surface of surfaceWords) {
      const key = options.normalizeWordKey(surface);
      if (!key) continue;
      const record = familiarityByWord[key];
      if (!record) continue;

      const isForgotten =
        record.encounters >= options.thresholds.minEncounters && record.familiarity < options.thresholds.maxFamiliarity;
      if (!isForgotten) continue;

      if (!pageForgottenWords.has(key)) {
        pageForgottenWords.set(key, {
          word: surface,
          familiarity: record.familiarity,
          encounters: record.encounters,
        });
        changed = true;
      }
    }

    if (!changed) return;

    const list = Array.from(pageForgottenWords.values()).sort(
      (a, b) => a.familiarity - b.familiarity || b.encounters - a.encounters || a.word.localeCompare(b.word)
    );
    options.emitContext({ forgottenWords: list });
  };

  const resetPageTracking = () => {
    pageForgottenWords.clear();
  };

  return Object.freeze({ getFamiliarityForWords, updateForgottenWordsForPage, resetPageTracking });
}

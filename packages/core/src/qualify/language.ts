import { z } from 'zod';
import { countLanguageCharStats } from './unicode';

export const DetectedLanguageSchema = z.enum(['en', 'ja', 'ko', 'fr', 'de', 'zh', 'unknown']);
export type DetectedLanguage = z.infer<typeof DetectedLanguageSchema>;

export const LanguageCharStatsSchema = z.object({
  totalChars: z.number().int().nonnegative(),
  letterLikeChars: z.number().int().nonnegative(),
  han: z.number().int().nonnegative(),
  kana: z.number().int().nonnegative(),
  hangul: z.number().int().nonnegative(),
  latin: z.number().int().nonnegative(),
});
export type LanguageCharStats = z.infer<typeof LanguageCharStatsSchema>;

export const DetectPrimaryLanguageInputSchema = z.object({
  text: z.string(),
});
export type DetectPrimaryLanguageInput = z.infer<typeof DetectPrimaryLanguageInputSchema>;

export const DetectPrimaryLanguageOutputSchema = z.object({
  language: DetectedLanguageSchema,
  confidence: z.number().min(0).max(1),
  stats: LanguageCharStatsSchema,
});
export type DetectPrimaryLanguageOutput = z.infer<typeof DetectPrimaryLanguageOutputSchema>;

function countCharStats(text: string): LanguageCharStats {
  return countLanguageCharStats(text);
}

const STOPWORDS_EN = [
  'the',
  'and',
  'to',
  'of',
  'in',
  'is',
  'that',
  'for',
  'on',
  'with',
  'as',
  'are',
  'was',
  'be',
] as const;
const STOPWORDS_FR = [
  'le',
  'la',
  'les',
  'de',
  'des',
  'et',
  'est',
  'en',
  'un',
  'une',
  'que',
  'pour',
  'dans',
  'pas',
  'sur',
] as const;
const STOPWORDS_DE = [
  'der',
  'die',
  'das',
  'und',
  'ist',
  'nicht',
  'ein',
  'eine',
  'zu',
  'mit',
  'auf',
  'im',
  'den',
  'von',
  'für',
] as const;

const STOPWORD_LANG = {
  en: 1 << 0,
  fr: 1 << 1,
  de: 1 << 2,
} as const;

const STOPWORD_MAP: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  const add = (token: string, flag: number) => {
    const prev = map.get(token) ?? 0;
    map.set(token, prev | flag);
  };

  for (const token of STOPWORDS_EN) add(token, STOPWORD_LANG.en);
  for (const token of STOPWORDS_FR) add(token, STOPWORD_LANG.fr);
  for (const token of STOPWORDS_DE) add(token, STOPWORD_LANG.de);

  return map;
})();

function scoreLatinLanguage(text: string): Exclude<DetectedLanguage, 'unknown' | 'zh' | 'ja' | 'ko'> {
  const tokens = text
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .filter(Boolean);

  let scoreEn = 0;
  let scoreFr = 0;
  let scoreDe = 0;

  for (const token of tokens) {
    const flags = STOPWORD_MAP.get(token);
    if (!flags) continue;
    if (flags & STOPWORD_LANG.en) scoreEn += 1;
    if (flags & STOPWORD_LANG.fr) scoreFr += 1;
    if (flags & STOPWORD_LANG.de) scoreDe += 1;
  }

  if (scoreFr > scoreEn && scoreFr > scoreDe) return 'fr';
  if (scoreDe > scoreEn && scoreDe > scoreFr) return 'de';
  return 'en';
}

/**
 * Heuristic language detection for short page/paragraph text.
 *
 * Guarantees:
 * - Pure TS (no browser APIs, no network)
 * - Returns one of the supported languages plus `unknown`
 *
 * Notes:
 * - CJK detection uses Unicode Script properties
 * - Latin languages use lightweight stopword scoring (en/fr/de)
 */
export function detectPrimaryLanguage(
  input: DetectPrimaryLanguageInput
): DetectPrimaryLanguageOutput {
  const text = input.text.trim();
  const stats = countCharStats(text);

  const denom = stats.letterLikeChars > 0 ? stats.letterLikeChars : 1;
  const ratios = {
    han: stats.han / denom,
    kana: stats.kana / denom,
    hangul: stats.hangul / denom,
    latin: stats.latin / denom,
  };

  if (stats.letterLikeChars < 5) {
    return { language: 'unknown', confidence: 0, stats };
  }

  if (ratios.hangul >= 0.2) return { language: 'ko', confidence: ratios.hangul, stats };
  if (ratios.kana >= 0.05) return { language: 'ja', confidence: ratios.kana, stats };

  if (ratios.han >= 0.2) {
    const confidence = Math.max(ratios.han, ratios.kana);
    const language = stats.kana > 0 ? 'ja' : 'zh';
    return { language, confidence, stats };
  }

  if (ratios.latin >= 0.2) {
    return { language: scoreLatinLanguage(text), confidence: ratios.latin, stats };
  }

  const bestRatio = Math.max(ratios.han, ratios.kana, ratios.hangul, ratios.latin);
  return { language: 'unknown', confidence: bestRatio, stats };
}


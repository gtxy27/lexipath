import { z } from 'zod';

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

const RE_HAN = /\p{Script=Han}/u;
const RE_HIRAGANA = /\p{Script=Hiragana}/u;
const RE_KATAKANA = /\p{Script=Katakana}/u;
const RE_HANGUL = /\p{Script=Hangul}/u;
const RE_LATIN = /\p{Script=Latin}/u;

function countCharStats(text: string): LanguageCharStats {
  let totalChars = 0;
  let letterLikeChars = 0;
  let han = 0;
  let kana = 0;
  let hangul = 0;
  let latin = 0;

  for (const char of text) {
    totalChars += 1;
    if (RE_HAN.test(char)) {
      han += 1;
      letterLikeChars += 1;
      continue;
    }
    if (RE_HIRAGANA.test(char) || RE_KATAKANA.test(char)) {
      kana += 1;
      letterLikeChars += 1;
      continue;
    }
    if (RE_HANGUL.test(char)) {
      hangul += 1;
      letterLikeChars += 1;
      continue;
    }
    if (RE_LATIN.test(char)) {
      latin += 1;
      letterLikeChars += 1;
      continue;
    }
  }

  return { totalChars, letterLikeChars, han, kana, hangul, latin };
}

function scoreLatinLanguage(text: string): Exclude<DetectedLanguage, 'unknown' | 'zh' | 'ja' | 'ko'> {
  const tokens = text
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .filter(Boolean);

  const en = new Set([
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
  ]);
  const fr = new Set([
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
  ]);
  const de = new Set([
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
  ]);

  let scoreEn = 0;
  let scoreFr = 0;
  let scoreDe = 0;

  for (const token of tokens) {
    if (en.has(token)) scoreEn += 1;
    if (fr.has(token)) scoreFr += 1;
    if (de.has(token)) scoreDe += 1;
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


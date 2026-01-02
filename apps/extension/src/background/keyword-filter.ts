import type { CEFRLevel } from '@lexipath/core';

const NUMBER_WORDS = new Set([
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred',
  'thousand',
  'million',
  'billion',
  'first',
  'second',
  'third',
]);

const BASIC_STOPWORDS = new Set([
  'a', 'an', 'the',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their',
  'and', 'or', 'but',
  'to', 'of', 'in', 'on', 'at', 'for', 'from', 'with', 'as', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did',
  'have', 'has', 'had',
  'not', 'no',
]);

function normalizeTerm(term: string): string {
  return term
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isDigitsOnly(term: string): boolean {
  return /^[0-9]+$/.test(term);
}

function isLikelyTrivialSingleWord(term: string, userLevel: CEFRLevel): boolean {
  const normalized = normalizeTerm(term);
  if (!normalized) return true;

  // Allow more basic words for early levels; become stricter at B1+.
  const strict = userLevel === 'B1' || userLevel === 'B2' || userLevel === 'C1' || userLevel === 'C2';
  if (!strict) return false;

  if (isDigitsOnly(normalized)) return true;
  if (NUMBER_WORDS.has(normalized)) return true;
  if (BASIC_STOPWORDS.has(normalized)) return true;
  return false;
}

export function filterSelectedKeywords(
  keywords: string[],
  options: { userLevel: CEFRLevel; scene?: 'subtitle' | 'web'; maxItems?: number }
): string[] {
  const scene = options.scene ?? 'subtitle';
  const maxItems = options.maxItems ?? 8;

  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const raw of keywords) {
    const normalized = normalizeTerm(raw);
    if (!normalized) continue;

    const isPhrase = normalized.includes(' ');

    // For now, only apply the aggressive trivial-word filter to subtitles.
    if (scene === 'subtitle' && !isPhrase) {
      if (isLikelyTrivialSingleWord(normalized, options.userLevel)) continue;
    }

    if (seen.has(normalized)) continue;
    seen.add(normalized);
    filtered.push(raw.replace(/\s+/g, ' ').trim());

    if (filtered.length >= maxItems) break;
  }

  return filtered;
}


import { lowerForMatch } from './match-normalize';

export type HighlightOffset = { start: number; end: number; term: string };

function isAsciiWordBoundaryChar(code: number): boolean {
  if (!Number.isFinite(code)) return false;
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x5f // _
  );
}

function hasAsciiWordBoundary(text: string, start: number, length: number): boolean {
  const beforeCode = start > 0 ? text.charCodeAt(start - 1) : Number.NaN;
  const afterCode = start + length < text.length ? text.charCodeAt(start + length) : Number.NaN;
  return !isAsciiWordBoundaryChar(beforeCode) && !isAsciiWordBoundaryChar(afterCode);
}

/**
 * Build deterministic term highlight offsets for a given `text`.
 *
 * Notes:
 * - Uses `lowerForMatch()` to avoid Unicode-lowercasing length drift.
 * - Avoids overlapping ranges by preferring longer terms first.
 * - Enforces ASCII word boundaries for Latin terms (heuristic: `/[A-Za-z]/`).
 */
export function buildHighlightOffsets(text: string, terms: string[]): HighlightOffset[] {
  const haystack = lowerForMatch(text);
  const uniqueTerms = Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean)));
  uniqueTerms.sort((a, b) => b.length - a.length);

  const taken: Array<{ start: number; end: number }> = [];
  const offsets: HighlightOffset[] = [];

  const overlaps = (start: number, end: number) => taken.some((range) => !(end <= range.start || start >= range.end));

  for (const term of uniqueTerms) {
    const needleLower = lowerForMatch(term);
    const len = needleLower.length;
    if (!len) continue;

    let idx = 0;
    while (idx < haystack.length) {
      const found = haystack.indexOf(needleLower, idx);
      if (found === -1) break;
      idx = found + len;

      const enforceBoundary = /[A-Za-z]/.test(term);
      if (enforceBoundary && !hasAsciiWordBoundary(text, found, len)) continue;
      if (overlaps(found, found + len)) continue;

      taken.push({ start: found, end: found + len });
      offsets.push({ start: found, end: found + len, term });
    }
  }

  offsets.sort((a, b) => a.start - b.start);
  return offsets;
}


import { describe, expect, it } from 'vitest';

import { buildHighlightOffsets } from './offsets';

describe('buildHighlightOffsets', () => {
  it('returns empty when no matches', () => {
    expect(buildHighlightOffsets('hello', ['world'])).toEqual([]);
  });

  it('prefers longer terms to avoid overlaps', () => {
    const text = 'hello';
    const offsets = buildHighlightOffsets(text, ['hell', 'hello']);
    expect(offsets).toEqual([{ start: 0, end: 5, term: 'hello' }]);
  });

  it('dedupes and trims terms', () => {
    const text = 'hello hello';
    const offsets = buildHighlightOffsets(text, [' hello ', 'hello', '']);

    expect(offsets).toEqual([
      { start: 0, end: 5, term: 'hello' },
      { start: 6, end: 11, term: 'hello' },
    ]);
  });

  it('enforces ASCII word boundaries for Latin terms', () => {
    // "he" should NOT match inside "the" (left side is a word char).
    expect(buildHighlightOffsets('the', ['he'])).toEqual([]);

    // But it should match as its own word.
    expect(buildHighlightOffsets('he, the', ['he'])).toEqual([{ start: 0, end: 2, term: 'he' }]);

    // Underscore counts as a word char, so this is not a boundary.
    expect(buildHighlightOffsets('foo_bar', ['foo'])).toEqual([]);
  });

  it('does not enforce boundaries for non-Latin terms', () => {
    const text = '\u4f60\u597d\u4e16\u754c';
    const offsets = buildHighlightOffsets(text, ['\u4f60\u597d']);
    expect(offsets).toEqual([{ start: 0, end: 2, term: '\u4f60\u597d' }]);
  });

  it('returns offsets sorted by start', () => {
    const text = 'b a';
    const offsets = buildHighlightOffsets(text, ['a', 'b']);
    expect(offsets.map((o) => o.start)).toEqual([0, 2]);
  });
});

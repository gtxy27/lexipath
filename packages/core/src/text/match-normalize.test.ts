import { describe, expect, it } from 'vitest';

import { lowerForMatch } from './match-normalize';

describe('lowerForMatch', () => {
  it('returns input for empty string', () => {
    expect(lowerForMatch('')).toBe('');
  });

  it('lowercases ASCII without changing length', () => {
    const input = 'AbC_X9';
    const out = lowerForMatch(input);
    expect(out).toBe('abc_x9');
    expect(out.length).toBe(input.length);
  });

  it('normalizes common punctuation without changing length', () => {
    const input = `\u2018a\u2019 \u201cB\u201d \u2013\u2014\u00a0C`;
    const out = lowerForMatch(input);

    expect(out).toBe(`'a' "b" -- c`);
    expect(out.length).toBe(input.length);
  });

  it('avoids Unicode lowercase expansion (U+0130)', () => {
    // JS "\u0130".toLowerCase() becomes "i\u0307" (length 2), which breaks offsets.
    const input = '\u0130';
    expect(input.toLowerCase().length).toBe(2);

    const out = lowerForMatch(input);
    expect(out).toBe('i');
    expect(out.length).toBe(1);
  });
});

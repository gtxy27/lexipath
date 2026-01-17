import { describe, expect, it } from 'vitest';

import { filterSelectedKeywords } from './keyword-filter';

describe('filterSelectedKeywords', () => {
  it('normalizes whitespace and dedupes case-insensitively', () => {
    const out = filterSelectedKeywords(['  Hello   world  ', 'hello world', 'HELLO   WORLD'], {
      userLevel: 'B2',
      scene: 'web',
    });
    expect(out).toEqual(['Hello world']);
  });

  it('filters trivial single words in subtitle scene for B1+', () => {
    const out = filterSelectedKeywords(['the', 'Apple', '42', 'hundred', 'go'], {
      userLevel: 'B2',
      scene: 'subtitle',
    });

    expect(out).toEqual(['Apple', 'go']);
  });

  it('keeps trivial single words in web scene (no aggressive filtering)', () => {
    const out = filterSelectedKeywords(['the', '42', 'hundred'], {
      userLevel: 'B2',
      scene: 'web',
    });

    expect(out).toEqual(['the', '42', 'hundred']);
  });

  it('does not filter phrases even in subtitle scene', () => {
    const out = filterSelectedKeywords(['in the', 'the'], {
      userLevel: 'B2',
      scene: 'subtitle',
    });

    expect(out).toEqual(['in the']);
  });

  it('respects maxItems', () => {
    const out = filterSelectedKeywords(['a', 'b', 'c', 'd'], {
      userLevel: 'A2',
      scene: 'web',
      maxItems: 2,
    });

    expect(out).toEqual(['a', 'b']);
  });
});

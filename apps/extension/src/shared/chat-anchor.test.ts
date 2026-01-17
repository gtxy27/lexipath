import { describe, expect, it } from 'vitest';

import { canonicalizeUrlForAnchorKey } from './chat-anchor';

describe('canonicalizeUrlForAnchorKey', () => {
  it('drops tracking query params (utm_*)', () => {
    expect(
      canonicalizeUrlForAnchorKey('https://example.com/a/b?utm_source=x&utm_medium=y&id=1')
    ).toBe('example.com/a/b?id=1');
  });

  it('keeps non-tracking query params and sorts them', () => {
    expect(canonicalizeUrlForAnchorKey('https://example.com/a?b=2&a=1')).toBe('example.com/a?a=1&b=2');
  });

  it('drops non-routing hash fragments', () => {
    expect(canonicalizeUrlForAnchorKey('https://example.com/a#section-2')).toBe('example.com/a');
  });

  it('keeps hash-based routing fragments', () => {
    expect(canonicalizeUrlForAnchorKey('https://example.com/app#/route?x=1')).toBe('example.com/app#/route?x=1');
    expect(canonicalizeUrlForAnchorKey('https://example.com/app#!/route')).toBe('example.com/app#!/route');
  });

  it('rejects non-http(s) URLs', () => {
    expect(canonicalizeUrlForAnchorKey('ftp://example.com/a')).toBe('');
  });
});

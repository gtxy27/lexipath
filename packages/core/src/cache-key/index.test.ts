import { describe, expect, it } from 'vitest';
import { makeCacheKey, stableStringify } from './index';

describe('cache-key', () => {
  it('stableStringify is deterministic and drops undefined fields', () => {
    const a = stableStringify({ b: 1, a: 2, c: undefined });
    const b = stableStringify({ a: 2, b: 1 });
    expect(a).toBe(b);
  });

  it('makeCacheKey is stable for equivalent params', () => {
    const k1 = makeCacheKey('TEST', { b: 1, a: 2, c: undefined });
    const k2 = makeCacheKey('TEST', { a: 2, b: 1 });
    expect(k1).toBe(k2);
  });

  it('makeCacheKey changes when params change', () => {
    const k1 = makeCacheKey('TEST', { a: 1 });
    const k2 = makeCacheKey('TEST', { a: 2 });
    expect(k1).not.toBe(k2);
  });
});


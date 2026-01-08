import { describe, expect, it, vi } from 'vitest';
import { createExpiringLruCache, getOrRunCachedTask } from './pipeline';

describe('pipeline caching', () => {
  it('treats falsy cached values as cache hits', async () => {
    const cache = createExpiringLruCache<number>(10);
    cache.set('k', 0, 10_000);

    const run = vi.fn(async () => ({ value: 1, ok: true }));
    const result = await getOrRunCachedTask(cache, new Map(), 'k', {
      ttlSuccessMs: 10_000,
      ttlFallbackMs: 1_000,
      run,
    });

    expect(result).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('treats empty string cached values as cache hits', async () => {
    const cache = createExpiringLruCache<string>(10);
    cache.set('k', '', 10_000);

    const run = vi.fn(async () => ({ value: 'x', ok: true }));
    const result = await getOrRunCachedTask(cache, new Map(), 'k', {
      ttlSuccessMs: 10_000,
      ttlFallbackMs: 1_000,
      run,
    });

    expect(result).toBe('');
    expect(run).not.toHaveBeenCalled();
  });
});


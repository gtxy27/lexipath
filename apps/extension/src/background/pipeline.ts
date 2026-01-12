export type CacheEntry<T> = { value: T; expiresAt: number };

export { makeCacheKey, stableStringify } from '@lexipath/core/cache-key';

export function createExpiringLruCache<T>(maxEntries: number) {
  const entries = new Map<string, CacheEntry<T>>();

  function get(key: string): T | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      entries.delete(key);
      return undefined;
    }

    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }

  function set(key: string, value: T, ttlMs: number) {
    entries.delete(key);
    entries.set(key, { value, expiresAt: Date.now() + ttlMs });

    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      entries.delete(oldestKey);
    }
  }

  return { get, set };
}

export async function dedupeInFlight<T>(
  inFlight: Map<string, Promise<T>>,
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = work().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

export async function getOrRunCachedTask<T>(
  cache: { get: (key: string) => T | undefined; set: (key: string, value: T, ttlMs: number) => void },
  inFlight: Map<string, Promise<T>>,
  key: string,
  options: {
    ttlSuccessMs: number;
    ttlFallbackMs: number;
    run: () => Promise<{ value: T; ok: boolean }>;
  }
): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  return dedupeInFlight(inFlight, key, async () => {
    const { value, ok } = await options.run();
    cache.set(key, value, ok ? options.ttlSuccessMs : options.ttlFallbackMs);
    return value;
  });
}

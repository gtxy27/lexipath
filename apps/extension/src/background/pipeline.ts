export type CacheEntry<T> = { value: T; expiresAt: number };

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

export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();

  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(',')}}`;
}

function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function makeCacheKey(type: string, params: Record<string, unknown>): string {
  const json = stableStringify(params);
  return `${type}:${fnv1a32Hex(json)}`;
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

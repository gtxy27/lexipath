/**
 * Stable object serialization for cache key generation.
 * Deterministic: same object always produces same string.
 */
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

/**
 * FNV-1a hash algorithm for fast, collision-resistant hashing.
 */
function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Generate cache key from type and parameters.
 * @param type - Cache key prefix/namespace
 * @param params - Object to hash
 * @returns Cache key in format "type:hash"
 */
export function makeCacheKey(type: string, params: Record<string, unknown>): string {
  const json = stableStringify(params);
  return `${type}:${fnv1a32Hex(json)}`;
}


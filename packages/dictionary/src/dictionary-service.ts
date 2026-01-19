import type {
  DictionaryConfig,
  DictionaryLanguage,
  DictionaryWord,
  LookupExplain,
  LookupResult,
} from './types';

const DEFAULT_CONFIG: DictionaryConfig = {
  dbName: 'lexipath-dictionary',
  version: 2,
};

const SUPPORTED_SEEDED_LANGS = ['en', 'ja', 'ko', 'zh'] as const;

type SeededLanguage = (typeof SUPPORTED_SEEDED_LANGS)[number];

type MetaRecord = { key: string; value: string; updatedAt: number };

type LookupCacheRecord = {
  key: string;
  word: string;
  fromLang: DictionaryLanguage;
  toLang: DictionaryLanguage;

  // Cache may come from online providers which use native language (e.g. zh-CN/zh-TW).
  // Keep it flexible to avoid losing cached entries.
  toLocale?: string;

  explain: LookupExplain;
  provider?: string;
  cachedAt: number;
  expiresAt?: number;
};

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function normalizeWordForLang(word: string, lang: DictionaryLanguage): string {
  const trimmed = word.trim();
  if (!trimmed) return '';
  if (lang === 'en' || lang === 'fr' || lang === 'de') {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function wordsStoreName(lang: SeededLanguage): string {
  return `words_${lang}`;
}

function mappingStoreName(a: SeededLanguage, b: SeededLanguage): string {
  return `${a}_${b}`;
}

function cacheKey(fromLang: DictionaryLanguage, toLang: DictionaryLanguage, word: string): string {
  return `${fromLang}:${toLang}:${word}`;
}

/**
 * Dictionary service backed by a normalized IndexedDB schema:
 * - words_{lang} stores with stable build-time numeric ids
 * - mapping stores (e.g. en_zh) with direction-specific ranks
 * - lookup_cache for online fallback results (kept separate from offline data)
 */
export class DictionaryService {
  private config: DictionaryConfig;
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(config: Partial<DictionaryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.version);

      request.onerror = () => {
        this.initPromise = null;
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.initPromise = null;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Drop legacy single-store schema if present (safe to drop; not released).
        if (db.objectStoreNames.contains('words')) {
          db.deleteObjectStore('words');
        }

        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains('lookup_cache')) {
          db.createObjectStore('lookup_cache', { keyPath: 'key' });
        }

        for (const lang of SUPPORTED_SEEDED_LANGS) {
          const storeName = wordsStoreName(lang);
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id' });
            store.createIndex('word', 'word', { unique: true });
            store.createIndex('frequency', 'frequency', { unique: false });
          }
        }

        // Mapping stores are created upfront (some may remain empty if not seeded).
        const mappingPairs: Array<[SeededLanguage, SeededLanguage]> = [
          ['en', 'zh'],
          ['ja', 'zh'],
          ['ko', 'zh'],
          ['en', 'ja'],
          ['en', 'ko'],
        ];

        for (const [a, b] of mappingPairs) {
          const storeName = mappingStoreName(a, b);
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: ['from_id', 'to_id'] });
            store.createIndex('from_id', 'from_id', { unique: false });
            store.createIndex('to_id', 'to_id', { unique: false });
          }
        }
      };
    });

    return this.initPromise;
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.initPromise = null;
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('IndexedDB unavailable');
    return this.db;
  }

  async getMeta(key: string): Promise<string | null> {
    const db = await this.getDb();
    const tx = db.transaction('meta', 'readonly');
    const store = tx.objectStore('meta');
    const raw = await requestToPromise(store.get(key));
    await transactionDone(tx);
    if (!raw || typeof raw !== 'object') return null;
    const rec = raw as MetaRecord;
    return typeof rec.value === 'string' ? rec.value : null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    await requestToPromise(store.put({ key, value, updatedAt: Date.now() } satisfies MetaRecord));
    await transactionDone(tx);
  }

  async clearStores(storeNames: string[]): Promise<void> {
    const db = await this.getDb();
    const unique = Array.from(new Set(storeNames));
    if (unique.length === 0) return;

    const tx = db.transaction(unique, 'readwrite');
    for (const name of unique) {
      await requestToPromise(tx.objectStore(name).clear());
    }
    await transactionDone(tx);
  }

  async importRecords(storeName: string, records: AsyncIterable<unknown>, options: { batchSize?: number } = {}): Promise<number> {
    const db = await this.getDb();
    const batchSize = typeof options.batchSize === 'number' && options.batchSize > 0 ? Math.floor(options.batchSize) : 2000;

    let batch: unknown[] = [];
    let total = 0;

    const flush = async () => {
      if (batch.length === 0) return;
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const rec of batch) {
        store.put(rec);
      }
      await transactionDone(tx);
      total += batch.length;
      batch = [];
    };

    for await (const rec of records) {
      batch.push(rec);
      if (batch.length >= batchSize) {
        await flush();
      }
    }

    await flush();
    return total;
  }

  async putLookupCache(options: {
    word: string;
    fromLang: DictionaryLanguage;
    toLang: DictionaryLanguage;
    toLocale?: string;
    explain: LookupExplain;
    provider: string;
    ttlMs?: number;
  }): Promise<void> {
    const normalized = normalizeWordForLang(options.word, options.fromLang);
    if (!normalized) return;

    const db = await this.getDb();
    const now = Date.now();
    const expiresAt = typeof options.ttlMs === 'number' && options.ttlMs > 0 ? now + Math.floor(options.ttlMs) : undefined;

    const record: LookupCacheRecord = {
      key: cacheKey(options.fromLang, options.toLang, normalized),
      word: normalized,
      fromLang: options.fromLang,
      toLang: options.toLang,
      ...(typeof options.toLocale === 'string' && options.toLocale.trim() ? { toLocale: options.toLocale.trim() } : {}),
      explain: options.explain,
      provider: options.provider,
      cachedAt: now,
      ...(expiresAt ? { expiresAt } : {}),
    };

    const tx = db.transaction('lookup_cache', 'readwrite');
    await requestToPromise(tx.objectStore('lookup_cache').put(record));
    await transactionDone(tx);
  }

  private async getLookupCache(options: {
    word: string;
    fromLang: DictionaryLanguage;
    toLang: DictionaryLanguage;
    toLocale?: string;
  }): Promise<LookupResult | null> {
    const normalized = normalizeWordForLang(options.word, options.fromLang);
    if (!normalized) return null;

    const db = await this.getDb();
    const tx = db.transaction('lookup_cache', 'readwrite');
    const store = tx.objectStore('lookup_cache');

    // Cache is keyed by (fromLang,toLang,word); toLocale is stored as metadata only.
    const raw = await requestToPromise(store.get(cacheKey(options.fromLang, options.toLang, normalized)));

    if (!raw || typeof raw !== 'object') {
      await transactionDone(tx);
      return null;
    }

    const record = raw as LookupCacheRecord;
    const now = Date.now();
    if (typeof record.expiresAt === 'number' && record.expiresAt > 0 && record.expiresAt <= now) {
      await requestToPromise(store.delete(record.key));
      await transactionDone(tx);
      return null;
    }

    await transactionDone(tx);

    return {
      query: { word: normalized, fromLang: options.fromLang, toLang: options.toLang },
      source: null,
      targets: [],
      explain: record.explain,
      meta: {
        origin: 'cache',
        ...(record.provider ? { provider: record.provider } : {}),
        cachedAt: record.cachedAt,
        ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
      },
    };
  }

  async lookup(word: string, fromLang: DictionaryLanguage, toLang: DictionaryLanguage): Promise<LookupResult | null> {
    const normalized = normalizeWordForLang(word, fromLang);
    if (!normalized) return null;

    // 1) Offline-first: try normalized three-hop lookup.
    const offline = await this.lookupOffline(normalized, fromLang, toLang);
    if (offline) return offline;

    // 2) Cache fallback: online results keyed by (fromLang,toLang,word).
    return this.getLookupCache({ word: normalized, fromLang, toLang });
  }

  async batchLookup(words: string[], fromLang: DictionaryLanguage, toLang: DictionaryLanguage): Promise<Array<LookupResult | null>> {
    if (words.length === 0) return [];
    return Promise.all(words.map((w) => this.lookup(w, fromLang, toLang)));
  }

  private async lookupOffline(word: string, fromLang: DictionaryLanguage, toLang: DictionaryLanguage): Promise<LookupResult | null> {
    const db = await this.getDb();

    // Only seeded languages are supported for offline traversal.
    const isSeededLang = (lang: DictionaryLanguage): lang is SeededLanguage =>
      (SUPPORTED_SEEDED_LANGS as readonly string[]).includes(lang);
    if (!isSeededLang(fromLang) || !isSeededLang(toLang)) return null;

    const fromStore = wordsStoreName(fromLang);
    const toStore = wordsStoreName(toLang);

    const pairStore = (() => {
      if (fromLang === toLang) return null;
      const direct = mappingStoreName(fromLang, toLang);
      if (db.objectStoreNames.contains(direct)) return direct;
      const reverse = mappingStoreName(toLang, fromLang);
      if (db.objectStoreNames.contains(reverse)) return reverse;
      return null;
    })();

    if (!pairStore) {
      // Same-language word detail lookup is allowed (targets empty).
      const tx = db.transaction(fromStore, 'readonly');
      const src = await requestToPromise(tx.objectStore(fromStore).index('word').get(word));
      await transactionDone(tx);
      if (!src) return null;
      return {
        query: { word, fromLang, toLang },
        source: src as DictionaryWord,
        targets: [],
        meta: { origin: 'offline' },
      };
    }

    const direction: 'direct' | 'reverse' = pairStore === mappingStoreName(fromLang, toLang) ? 'direct' : 'reverse';

    const tx = db.transaction([fromStore, pairStore, toStore], 'readonly');
    const fromWordStore = tx.objectStore(fromStore);
    const mapping = tx.objectStore(pairStore);
    const toWordStore = tx.objectStore(toStore);

    const source = (await requestToPromise(fromWordStore.index('word').get(word))) as DictionaryWord | undefined;
    if (!source) {
      await transactionDone(tx);
      return null;
    }

    const mappings: Array<{ from_id: number; to_id: number } & Record<string, unknown>> = [];

    const fromId = source.id;
    const cursorIndex = direction === 'direct' ? mapping.index('from_id') : mapping.index('to_id');
    const key = IDBKeyRange.only(fromId);

    await new Promise<void>((resolve, reject) => {
      const req = cursorIndex.openCursor(key);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const value = cursor.value;
        if (!value || typeof value !== 'object') {
          cursor.continue();
          return;
        }
        const rec = value as Record<string, unknown>;
        if (typeof rec.from_id === 'number' && typeof rec.to_id === 'number') {
          mappings.push(rec as { from_id: number; to_id: number } & Record<string, unknown>);
        }

        cursor.continue();
      };
    });

    if (mappings.length === 0) {
      await transactionDone(tx);
      return null;
    }

    // Rank fields are stored for both directions; for a lookup (fromLang -> toLang)
    // we always order by rank_{fromLang}, regardless of whether we traverse a direct or reverse store.
    const rankKey = `rank_${fromLang}`;

    const sorted = mappings
      .slice()
      .sort((a, b) => {
        const ra = typeof a[rankKey] === 'number' ? (a[rankKey] as number) : 1e9;
        const rb = typeof b[rankKey] === 'number' ? (b[rankKey] as number) : 1e9;

        return ra - rb;
      });

    const targetIds = sorted.map((m) => (direction === 'direct' ? m.to_id : m.from_id));
    const targets: DictionaryWord[] = [];

    for (const id of targetIds) {
      const raw = await requestToPromise(toWordStore.get(id));
      if (raw) targets.push(raw as DictionaryWord);
    }

    await transactionDone(tx);

    return {
      query: { word, fromLang, toLang },
      source,
      targets,
      meta: { origin: 'offline' },
    };
  }
}


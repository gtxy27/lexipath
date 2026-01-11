import type { WordEntry, DictionaryConfig } from './types';

const DEFAULT_CONFIG: DictionaryConfig = {
  dbName: 'lexipath-dictionary',
  storeName: 'words',
  version: 1,
};

/**
 * Dictionary service with IndexedDB storage.
 * Provides offline-first word lookup with optional online fallback.
 */
export class DictionaryService {
  private config: DictionaryConfig;
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(config: Partial<DictionaryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the IndexedDB database.
   */
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
        if (!db.objectStoreNames.contains(this.config.storeName)) {
          const store = db.createObjectStore(this.config.storeName, { keyPath: 'word' });
          store.createIndex('difficulty', 'difficulty', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Look up a word in the dictionary.
   * Optimized: parallel batch lookup instead of serial attempts.
   */
  async lookup(word: string): Promise<WordEntry | null> {
    if (!this.db) {
      await this.init();
    }

    const db = this.db;
    if (!db) {
      throw new Error('DictionaryService.init did not initialize IndexedDB');
    }

    const normalized = word.trim().toLowerCase();
    const stripped = normalized.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

    const candidates = (() => {
      const list: string[] = [];
      const seen = new Set<string>();
      const push = (value: string) => {
        const v = value.trim().toLowerCase();
        if (!v) return;
        if (v.length < 2) return;
        if (seen.has(v)) return;
        seen.add(v);
        list.push(v);
      };

      push(normalized);
      push(stripped);

      const base = stripped || normalized;
      if (base.endsWith("'s")) push(base.slice(0, -2));

      if (base.endsWith('ies') && base.length > 4) push(`${base.slice(0, -3)}y`);
      if (base.endsWith('es') && base.length > 3) push(base.slice(0, -2));
      if (base.endsWith('s') && base.length > 3 && !base.endsWith('ss')) push(base.slice(0, -1));

      if (base.endsWith('ed') && base.length > 3) {
        const stem = base.slice(0, -2);
        push(stem);
        push(`${stem}e`);
      }
      if (base.endsWith('ing') && base.length > 4) {
        const stem = base.slice(0, -3);
        push(stem);
        push(`${stem}e`);
      }

      return list;
    })();

    // Parallel lookup in a single transaction
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readonly');
      const store = transaction.objectStore(this.config.storeName);
      const results: Array<WordEntry | null> = new Array(candidates.length).fill(null);
      let completed = 0;
      let resolved = false;

      transaction.onerror = () => {
        if (!resolved) reject(transaction.error);
      };
      transaction.onabort = () => {
        if (!resolved) reject(transaction.error);
      };

      for (let i = 0; i < candidates.length; i += 1) {
        const key = candidates[i];
        if (!key) {
          completed += 1;
          // Check if all completed after skipping empty key
          if (!resolved && completed === candidates.length) {
            resolved = true;
            resolve(null);
          }
          continue;
        }

        const request = store.get(key);
        request.onerror = () => {
          if (!resolved) reject(request.error);
        };
        request.onsuccess = () => {
          results[i] = request.result || null;
          completed += 1;

          // Return first found result immediately
          const found = results[i];
          if (!resolved && found) {
            resolved = true;
            resolve(found);
          }

          // All requests completed, no result found
          if (!resolved && completed === candidates.length) {
            resolved = true;
            resolve(null);
          }
        };
      }

      // Handle empty candidates
      if (candidates.length === 0) {
        resolved = true;
        resolve(null);
      }
    });
  }

  /**
   * Look up multiple words in a single IndexedDB transaction.
   * Returns results aligned to the input order.
   */
  async batchLookup(words: string[]): Promise<Array<WordEntry | null>> {
    if (!this.db) {
      await this.init();
    }

    const db = this.db;
    if (!db) {
      throw new Error('DictionaryService.init did not initialize IndexedDB');
    }

    if (words.length === 0) return [];

    const normalizedWords = words.map((word) => word.toLowerCase());

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readonly');
      const store = transaction.objectStore(this.config.storeName);
      const results: Array<WordEntry | null> = new Array(normalizedWords.length).fill(null);

      transaction.oncomplete = () => resolve(results);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);

      for (let i = 0; i < normalizedWords.length; i += 1) {
        const word = normalizedWords[i];
        if (!word) continue;

        const request = store.get(word);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          results[i] = request.result || null;
        };
      }
    });
  }

  /**
   * Add or update a word entry.
   */
  async upsert(entry: WordEntry): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    const db = this.db;
    if (!db) {
      throw new Error('DictionaryService.init did not initialize IndexedDB');
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readwrite');
      const store = transaction.objectStore(this.config.storeName);
      const request = store.put({ ...entry, word: entry.word.toLowerCase() });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Bulk import word entries.
   */
  async bulkImport(entries: WordEntry[]): Promise<void> {
    if (!this.db) {
      await this.init();
    }

    const db = this.db;
    if (!db) {
      throw new Error('DictionaryService.init did not initialize IndexedDB');
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.config.storeName, 'readwrite');
      const store = transaction.objectStore(this.config.storeName);

      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();

      for (const entry of entries) {
        store.put({ ...entry, word: entry.word.toLowerCase() });
      }
    });
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db?.close();
    this.db = null;
    this.initPromise = null;
  }
}

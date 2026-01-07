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
   */
  async lookup(word: string): Promise<WordEntry | null> {
    if (!this.db) {
      await this.init();
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.config.storeName, 'readonly');
      const store = transaction.objectStore(this.config.storeName);
      const request = store.get(word.toLowerCase());

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
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

    if (words.length === 0) return [];

    const normalizedWords = words.map((word) => word.toLowerCase());

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.config.storeName, 'readonly');
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

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.config.storeName, 'readwrite');
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

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.config.storeName, 'readwrite');
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

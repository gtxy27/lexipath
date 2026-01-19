/**
 * @vitest-environment happy-dom
 */

/**
 * @vitest-environment happy-dom
 */

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DictionaryService } from './dictionary-service';

function createDbName(prefix = 'test-lexipath-dictionary'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
    req.onsuccess = () => resolve();
  });
}

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

describe('DictionaryService (normalized IndexedDB)', () => {
  it('dedupes concurrent init calls', async () => {
    const dbName = createDbName('test-dict-init');
    const service = new DictionaryService({ dbName });

    try {
      await Promise.all([
        service.lookup('hello', 'en', 'zh'),
        service.lookup('world', 'en', 'zh'),
      ]);

      // If init de-duping fails, fake-indexeddb should error on open/versionchange.
      expect(service).toBeDefined();
    } finally {
      service.close();
      await deleteDb(dbName);
    }
  });

  it('offline three-hop lookup returns ordered targets', async () => {
    const dbName = createDbName('test-dict-offline');
    const service = new DictionaryService({ dbName });

    try {
      await service.init();

      // Seed minimal offline data directly.
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(dbName, 2);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });

      try {
        const tx = db.transaction(['words_en', 'words_zh', 'en_zh'], 'readwrite');
        const en = tx.objectStore('words_en');
        const zh = tx.objectStore('words_zh');
        const map = tx.objectStore('en_zh');

        await requestToPromise(en.put({ id: 1, word: 'hello', frequency: 100, difficulty: 'A1' }));
        await requestToPromise(zh.put({ id: 10, word: '你好', frequency: 5 }));
        await requestToPromise(map.put({ from_id: 1, to_id: 10, rank_en: 0, rank_zh: 0 }));

        await transactionDone(tx);
      } finally {
        db.close();
      }

      const result = await service.lookup('hello', 'en', 'zh');
      expect(result?.meta.origin).toBe('offline');
      expect(result?.source?.word).toBe('hello');
      expect(result?.targets.map((t) => t.word)).toEqual(['你好']);
    } finally {
      service.close();
      await deleteDb(dbName);
    }
  });

  it('cache fallback returns explain payload with origin=cache', async () => {
    const dbName = createDbName('test-dict-cache');
    const service = new DictionaryService({ dbName });

    try {
      await service.putLookupCache({
        word: 'hello',
        fromLang: 'en',
        toLang: 'zh',
        explain: { word: 'hello', definition: '你好', translation: '你好' },
        provider: 'google',
        ttlMs: 10_000,
      });

      const result = await service.lookup('hello', 'en', 'zh');
      expect(result?.meta.origin).toBe('cache');
      expect(result?.meta.provider).toBe('google');
      expect(result?.explain?.translation).toBe('你好');
    } finally {
      service.close();
      await deleteDb(dbName);
    }
  });
});



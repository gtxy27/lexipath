/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi } from 'vitest';
import { DictionaryService } from './dictionary-service';

type OpenRequest = {
  result?: any;
  error?: any;
  onsuccess?: (() => void) | null;
  onerror?: (() => void) | null;
  onupgradeneeded?: ((event: any) => void) | null;
};

function createStoreGetRequest(result: any) {
  const req: any = { result: undefined, onsuccess: null, onerror: null, error: null };
  queueMicrotask(() => {
    req.result = result;
    req.onsuccess?.();
  });
  return req;
}

describe('DictionaryService init de-duplication', () => {
  it('dedupes concurrent init calls (indexedDB.open called once)', async () => {
    const openMock = vi.fn((_name: string, _version?: number) => {
      const request: OpenRequest = { onsuccess: null, onerror: null, onupgradeneeded: null };

      const fakeDb: any = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({ createIndex: () => undefined }),
        close: () => undefined,
        transaction: () => ({
          objectStore: () => ({
            get: () => createStoreGetRequest(null),
          }),
        }),
      };

      queueMicrotask(() => {
        request.result = fakeDb;
        request.onsuccess?.();
      });

      return request as any;
    });

    (globalThis as any).indexedDB = { open: openMock };

    const service = new DictionaryService({ dbName: 'test-db', storeName: 'words', version: 1 });

    await Promise.all([service.lookup('apple'), service.lookup('banana')]);

    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it('batchLookup uses a single transaction and normalizes words', async () => {
    const transactionMock = vi.fn(() => {
      let pending = 0;
      const tx: any = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: () => ({
          get: (key: string) => {
            pending += 1;
            const req = createStoreGetRequest({ word: key });
            queueMicrotask(() => {
              pending -= 1;
              if (pending === 0) tx.oncomplete?.();
            });
            return req;
          },
        }),
      };

      return tx;
    });

    const openMock = vi.fn((_name: string, _version?: number) => {
      const request: OpenRequest = { onsuccess: null, onerror: null, onupgradeneeded: null };

      const fakeDb: any = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => ({ createIndex: () => undefined }),
        close: () => undefined,
        transaction: transactionMock,
      };

      queueMicrotask(() => {
        request.result = fakeDb;
        request.onsuccess?.();
      });

      return request as any;
    });

    (globalThis as any).indexedDB = { open: openMock };

    const service = new DictionaryService({ dbName: 'test-db', storeName: 'words', version: 1 });

    const results = await service.batchLookup(['Apple', 'BANANA']);

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0]?.word).toBe('apple');
    expect(results[1]?.word).toBe('banana');
  });
});


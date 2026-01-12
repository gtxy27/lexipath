import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { SettingsSchema } from '@lexipath/core';
import { StorageService } from './storage-service';
import type { StorageExportData } from './types';

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openDb(name: string, version = 1): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
  });
}

function createDbName(prefix = 'test-lexipath-storage'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe('StorageService', () => {
  it('persists settings and caches reads', async () => {
    const dbName = createDbName();
    const service = new StorageService({ dbName });

    try {
      const settings = SettingsSchema.parse({ theme: 'dark' });
      await service.setSettings(settings);

      const firstRead = await service.getSettings();
      expect(firstRead).toEqual(settings);

      const db = await openDb(dbName);
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      await new Promise<void>((resolve, reject) => {
        const req = store.put({ key: 'settings', value: SettingsSchema.parse({ theme: 'light' }) });
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve();
      });
      await transactionDone(tx);
      db.close();

      const cachedRead = await service.getSettings();
      expect(cachedRead?.theme).toBe('dark');

      service.close();
      const freshService = new StorageService({ dbName });
      const freshRead = await freshService.getSettings();
      expect(freshRead?.theme).toBe('light');
      freshService.close();
    } finally {
      service.close();
      await deleteDb(dbName);
    }
  });

  it('adds messages, touches sessions, and supports search + delete', async () => {
    const dbName = createDbName();
    const service = new StorageService({ dbName });
    const nowSpy = vi.spyOn(Date, 'now');

    try {
      nowSpy.mockReturnValue(1000);
      const id1 = await service.addMessage({
        sessionId: 's1',
        role: 'user',
        content: 'Hello world',
        timestamp: 10,
      });
      expect(id1).toBe(1);

      const session1 = await service.getSession('s1');
      expect(session1).toEqual({
        sessionId: 's1',
        keyword: '',
        conversationIndex: 0,
        createdAt: 1000,
        lastAccessedAt: 1000,
      });

      nowSpy.mockReturnValue(2000);
      const id2 = await service.addMessage({
        sessionId: 's1',
        role: 'assistant',
        content: 'Hello there',
        thinking: '- Draft reply\n- Check tone',
        timestamp: 20,
      });
      expect(id2).toBe(2);

      const session2 = await service.getSession('s1');
      expect(session2?.createdAt).toBe(1000);
      expect(session2?.lastAccessedAt).toBe(2000);

      const all = await service.getMessages('s1');
      expect(all.map((m) => m.id)).toEqual([1, 2]);
      expect(all.map((m) => m.timestamp)).toEqual([10, 20]);
      expect(all[1]?.thinking).toContain('Draft reply');

      const lastOnly = await service.getMessages('s1', { limit: 1 });
      expect(lastOnly.map((m) => m.id)).toEqual([2]);

      const hello = await service.searchMessages('hello');
      expect(hello.map((m) => m.id)).toEqual([2, 1]);

      const helloWorld = await service.searchMessages('hello world');
      expect(helloWorld.map((m) => m.id)).toEqual([1]);

      const world = await service.searchMessages('world');
      expect(world.map((m) => m.id)).toEqual([1]);

      await service.deleteMessage(1);
      const worldAfterDelete = await service.searchMessages('world');
      expect(worldAfterDelete).toEqual([]);
    } finally {
      nowSpy.mockRestore();
      service.close();
      await deleteDb(dbName);
    }
  });

  it('exportAll + importAll (overwrite) roundtrips data and rebuilds index', async () => {
    const dbName1 = createDbName('test-storage-export');
    const dbName2 = createDbName('test-storage-import');
    const service1 = new StorageService({ dbName: dbName1 });
    const service2 = new StorageService({ dbName: dbName2 });
    const nowSpy = vi.spyOn(Date, 'now');

    try {
      nowSpy.mockReturnValue(1234);
      await service1.setSettings(SettingsSchema.parse({ theme: 'dark' }));
      await service1.upsertWordFamiliarity({
        word: 'hello',
        familiarity: 10,
        lastSeen: 100,
        encounters: 1,
      });
      await service1.addMessage({
        sessionId: 's1',
        role: 'user',
        content: 'Hello world',
        timestamp: 10,
      });
      await service1.addMessage({
        sessionId: 's1',
        role: 'assistant',
        content: 'Hi again',
        thinking: 'Internal notes',
        timestamp: 20,
      });

      const exported = await service1.exportAll();
      expect(exported.version).toBe('1.0');
      expect(exported.settings.theme).toBe('dark');

      await service2.importAll(exported, { strategy: 'overwrite' });

      const roundtrip = await service2.exportAll();
      expect(roundtrip).toMatchObject({
        version: '1.0',
        settings: exported.settings,
        sessions: exported.sessions,
        messages: exported.messages,
        familiarity: exported.familiarity,
      } satisfies Partial<StorageExportData>);

      const search = await service2.searchMessages('world');
      expect(search).toHaveLength(1);
      expect(search[0]?.content).toContain('world');
    } finally {
      nowSpy.mockRestore();
      service1.close();
      service2.close();
      await deleteDb(dbName1);
      await deleteDb(dbName2);
    }
  });

  it('importAll (merge) keeps local settings, merges sessions, dedupes messages, and max-merges familiarity', async () => {
    const dbName = createDbName('test-storage-merge');
    const service = new StorageService({ dbName });

    try {
      await service.setSettings(SettingsSchema.parse({ theme: 'dark' }));
      await service.upsertSession({
        sessionId: 's1',
        keyword: 'local',
        conversationIndex: 5,
        createdAt: 100,
        lastAccessedAt: 500,
      });
      await service.upsertWordFamiliarity({
        word: 'hello',
        familiarity: 10,
        lastSeen: 1000,
        encounters: 1,
      });

      await service.addMessageWithoutTouchingSession({
        sessionId: 's1',
        role: 'user',
        content: 'Hello   world',
        timestamp: 10,
      });

      await service.addMessageWithoutTouchingSession({
        sessionId: 's1',
        role: 'assistant',
        content: 'New message',
        timestamp: 20,
      });

      const importPayload: StorageExportData = {
        version: '1.0',
        exportedAt: 9999,
        settings: SettingsSchema.parse({ theme: 'light' }),
        sessions: [
          {
            sessionId: 's1',
            keyword: 'remote',
            conversationIndex: 3,
            createdAt: 50,
            lastAccessedAt: 600,
          },
          {
            sessionId: 's2',
            keyword: '',
            conversationIndex: 0,
            createdAt: 1,
            lastAccessedAt: 2,
          },
        ],
        messages: [
          {
            id: 101,
            sessionId: 's1',
            role: 'user',
            content: 'Hello world',
            timestamp: 10,
          },
          {
            id: 102,
            sessionId: 's1',
            role: 'assistant',
            content: 'New message',
            thinking: 'Reasoning details',
            timestamp: 20,
          },
        ],
        familiarity: [
          {
            word: 'hello',
            familiarity: 20,
            lastSeen: 900,
            encounters: 2,
          },
        ],
      };

      await service.importAll(importPayload, { strategy: 'merge' });

      const settings = await service.getSettings();
      expect(settings?.theme).toBe('dark');

      const mergedSession = await service.getSession('s1');
      expect(mergedSession).toEqual({
        sessionId: 's1',
        keyword: 'local',
        conversationIndex: 5,
        createdAt: 50,
        lastAccessedAt: 600,
      });

      const allMessages = await service.getMessages('s1');
      expect(allMessages).toHaveLength(2);
      expect(allMessages.map((m) => m.content)).toEqual(['Hello   world', 'New message']);
      expect(allMessages[1]?.thinking).toBe('Reasoning details');

      const familiarity = await service.getWordFamiliarity('hello');
      expect(familiarity).toEqual({
        word: 'hello',
        familiarity: 20,
        lastSeen: 1000,
        encounters: 2,
      });

      const search = await service.searchMessages('world');
      expect(search).toHaveLength(1);
      expect(search[0]?.content).toContain('world');
    } finally {
      service.close();
      await deleteDb(dbName);
    }
  });
});

import { SettingsSchema, WordFamiliaritySchema, type Settings, type WordFamiliarity } from '@lexipath/core';
import { z } from 'zod';
import {
  StorageExportSchema,
  type ChatMessageRecord,
  type ChatMessageRecordWithId,
  type ChatSessionRecord,
  type StorageExportData,
} from './types';

type MetaKey =
  | 'migration_v1_completed'
  | 'migration_settings_v1'
  | 'migration_chat_v1'
  | 'migration_familiarity_v1';
type MetaRecord = { key: MetaKey; value: boolean; updatedAt: number };

type SettingsRecord = { key: 'settings'; value: Settings };

type ChatSessionStoreRecord = ChatSessionRecord;
type ChatMessageStoreRecord = Omit<ChatMessageRecordWithId, 'id'> & { id?: number };

type TermMessageRecord = {
  term: string;
  messageId: number;
  sessionId: string;
};

type DbConfig = {
  dbName: string;
  version: number;
};

const DEFAULT_CONFIG: DbConfig = {
  dbName: 'lexipath-storage',
  version: 2,
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

function normalizeTerm(input: string): string {
  return input.trim().toLowerCase();
}

function tokenizeForIndex(text: string): string[] {
  const normalized = text.toLowerCase();
  const terms: string[] = [];

  const asciiWordMatches = normalized.match(/[a-z0-9]+/g) ?? [];
  for (const term of asciiWordMatches) {
    if (term.length >= 2) terms.push(term);
  }

  const cjkRuns = normalized.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const run of cjkRuns) {
    if (run.length === 1) {
      terms.push(run);
      continue;
    }
    for (const ch of run) terms.push(ch);
    for (let i = 0; i < run.length - 1; i += 1) {
      terms.push(run.slice(i, i + 2));
    }
  }

  return Array.from(new Set(terms));
}

function messageDedupeKey(record: {
  sessionId: string;
  role: string;
  timestamp: number;
  content: string;
}): string {
  const content = record.content.trim().replace(/\s+/g, ' ');
  return `${record.sessionId}\u0000${record.role}\u0000${record.timestamp}\u0000${content}`;
}

export class StorageService {
  private config: DbConfig;
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  private settingsCache: Settings | null = null;

  constructor(config: Partial<DbConfig> = {}) {
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
        const request = event.target as IDBOpenDBRequest;
        const db = request.result;
        const tx = request.transaction;
        const oldVersion = typeof event.oldVersion === 'number' ? event.oldVersion : 0;

        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains('chat_sessions')) {
          const store = db.createObjectStore('chat_sessions', { keyPath: 'sessionId' });
          store.createIndex('keyword', 'keyword', { unique: false });
          store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
          store.createIndex('kind', 'kind', { unique: false });
          store.createIndex('anchorKey', 'anchorKey', { unique: false });
        } else if (tx) {
          const store = tx.objectStore('chat_sessions');
          if (!store.indexNames.contains('keyword')) {
            store.createIndex('keyword', 'keyword', { unique: false });
          }
          if (!store.indexNames.contains('lastAccessedAt')) {
            store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
          }
          if (!store.indexNames.contains('kind')) {
            store.createIndex('kind', 'kind', { unique: false });
          }
          if (!store.indexNames.contains('anchorKey')) {
            store.createIndex('anchorKey', 'anchorKey', { unique: false });
          }

          // v2: persist session metadata (kind/label/anchorKey)
          if (oldVersion < 2) {
            store.openCursor().onsuccess = (cursorEvent) => {
              const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue | null>).result;
              if (!cursor) return;

              const raw = cursor.value as Record<string, unknown>;
              const keyword = typeof raw.keyword === 'string' ? raw.keyword : '';
              const hasKind = typeof raw.kind === 'string';
              const hasLabel = typeof raw.label === 'string';
              const hasAnchorKey = typeof raw.anchorKey === 'string';
              if (hasKind && hasLabel && hasAnchorKey) {
                cursor.continue();
                return;
              }

              const kind = keyword.trim() ? 'keyword' : 'general';
              const label = kind === 'keyword' ? keyword : 'General';
              const anchorKey = '';

              cursor.update({
                ...raw,
                kind,
                label,
                anchorKey,
              });
              cursor.continue();
            };
          }
        }


        if (!db.objectStoreNames.contains('chat_messages')) {
          const store = db.createObjectStore('chat_messages', {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('sessionId', 'sessionId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('chat_term_messages')) {
          const store = db.createObjectStore('chat_term_messages', {
            keyPath: ['term', 'messageId'],
          });
          store.createIndex('term', 'term', { unique: false });
          store.createIndex('sessionId', 'sessionId', { unique: false });
        }

        if (!db.objectStoreNames.contains('familiarity')) {
          db.createObjectStore('familiarity', { keyPath: 'word' });
        }
      };
    });

    return this.initPromise;
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.initPromise = null;
    this.settingsCache = null;
  }

  private async getDb(): Promise<IDBDatabase> {
    if (!this.db) await this.init();
    if (!this.db) throw new Error('IndexedDB unavailable');
    return this.db;
  }

  async getMeta(key: MetaKey): Promise<boolean> {
    const db = await this.getDb();
    const tx = db.transaction('meta', 'readonly');
    const store = tx.objectStore('meta');
    const raw = await requestToPromise(store.get(key));
    await transactionDone(tx);
    return !!(raw && typeof raw === 'object' && (raw as MetaRecord).value === true);
  }

  async setMeta(key: MetaKey, value: boolean): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction('meta', 'readwrite');
    const store = tx.objectStore('meta');
    await requestToPromise(store.put({ key, value, updatedAt: Date.now() } satisfies MetaRecord));
    await transactionDone(tx);
  }

  // =============================================================================
  // Settings
  // =============================================================================

  async getSettings(): Promise<Settings | null> {
    if (this.settingsCache) return this.settingsCache;

    const db = await this.getDb();
    const tx = db.transaction('settings', 'readonly');
    const store = tx.objectStore('settings');
    const raw = await requestToPromise(store.get('settings'));
    await transactionDone(tx);

    if (!raw || typeof raw !== 'object') return null;
    const parsed = z
      .object({ key: z.literal('settings'), value: SettingsSchema })
      .strict()
      .safeParse(raw);
    if (!parsed.success) return null;

    this.settingsCache = parsed.data.value;
    return parsed.data.value;
  }

  async setSettings(settings: Settings): Promise<void> {
    const parsed = SettingsSchema.parse(settings);
    const db = await this.getDb();
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    await requestToPromise(store.put({ key: 'settings', value: parsed } satisfies SettingsRecord));
    await transactionDone(tx);
    this.settingsCache = parsed;
  }

  // =============================================================================
  // Familiarity
  // =============================================================================

  async getWordFamiliarity(word: string): Promise<WordFamiliarity | null> {
    const db = await this.getDb();
    const tx = db.transaction('familiarity', 'readonly');
    const store = tx.objectStore('familiarity');
    const raw = await requestToPromise(store.get(word));
    await transactionDone(tx);
    const parsed = WordFamiliaritySchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async batchGetWordFamiliarity(words: string[]): Promise<Map<string, WordFamiliarity>> {
    const db = await this.getDb();
    const tx = db.transaction('familiarity', 'readonly');
    const store = tx.objectStore('familiarity');

    const unique = Array.from(new Set(words));
    const pairs = await Promise.all(
      unique.map(async (word) => {
        const raw = await requestToPromise(store.get(word));
        const parsed = WordFamiliaritySchema.safeParse(raw);
        return [word, parsed.success ? parsed.data : null] as const;
      })
    );

    await transactionDone(tx);

    const out = new Map<string, WordFamiliarity>();
    for (const [word, record] of pairs) {
      if (record) out.set(word, record);
    }
    return out;
  }

  async upsertWordFamiliarity(record: WordFamiliarity): Promise<void> {
    const parsed = WordFamiliaritySchema.parse(record);
    const db = await this.getDb();
    const tx = db.transaction('familiarity', 'readwrite');
    const store = tx.objectStore('familiarity');
    await requestToPromise(store.put(parsed));
    await transactionDone(tx);
  }

  async listWordFamiliarity(): Promise<WordFamiliarity[]> {
    const db = await this.getDb();
    const tx = db.transaction('familiarity', 'readonly');
    const store = tx.objectStore('familiarity');
    const results: WordFamiliarity[] = [];

    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const parsed = WordFamiliaritySchema.safeParse(cursor.value);
        if (parsed.success) results.push(parsed.data);
        cursor.continue();
      };
    });

    await transactionDone(tx);
    return results;
  }

  // =============================================================================
  // Chat sessions & messages
  // =============================================================================

  async getSession(sessionId: string): Promise<ChatSessionRecord | null> {
    const db = await this.getDb();
    const tx = db.transaction('chat_sessions', 'readonly');
    const store = tx.objectStore('chat_sessions');
    const raw = await requestToPromise(store.get(sessionId));
    await transactionDone(tx);
    const parsed = StorageExportSchema.shape.sessions.element.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async upsertSession(session: ChatSessionRecord): Promise<void> {
    const parsed = StorageExportSchema.shape.sessions.element.parse(session);
    const db = await this.getDb();
    const tx = db.transaction('chat_sessions', 'readwrite');
    const store = tx.objectStore('chat_sessions');
    await requestToPromise(store.put(parsed satisfies ChatSessionStoreRecord));
    await transactionDone(tx);
  }

  async getSessionsByKeyword(keyword: string): Promise<ChatSessionRecord[]> {
    const db = await this.getDb();
    const tx = db.transaction('chat_sessions', 'readonly');
    const store = tx.objectStore('chat_sessions');
    const index = store.index('keyword');
    const range = IDBKeyRange.only(keyword);
    const results: ChatSessionRecord[] = [];

    await new Promise<void>((resolve, reject) => {
      const request = index.openCursor(range);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const parsed = StorageExportSchema.shape.sessions.element.safeParse(cursor.value);
        if (parsed.success) results.push(parsed.data);
        cursor.continue();
      };
    });

    await transactionDone(tx);
    return results.sort((a, b) => b.lastAccessedAt - a.lastAccessedAt);
  }

  async addMessage(message: ChatMessageRecord): Promise<number> {
    return this.addMessageInternal(message, { touchSession: true });
  }

  async addMessageWithoutTouchingSession(message: ChatMessageRecord): Promise<number> {
    return this.addMessageInternal(message, { touchSession: false });
  }

  private async addMessageInternal(
    message: ChatMessageRecord,
    options: { touchSession: boolean }
  ): Promise<number> {
    const messageSchema = StorageExportSchema.shape.messages.element.omit({ id: true });
    const parsed = messageSchema.parse(message);
    const db = await this.getDb();
    const tx = db.transaction(['chat_messages', 'chat_term_messages', 'chat_sessions'], 'readwrite');

    const messageStore = tx.objectStore('chat_messages');
    const termStore = tx.objectStore('chat_term_messages');
    const sessionStore = tx.objectStore('chat_sessions');

    const id = await requestToPromise(messageStore.add(parsed satisfies ChatMessageStoreRecord));

    const numericId = typeof id === 'number' ? id : Number(id);
    if (!Number.isFinite(numericId)) {
      throw new Error('Invalid auto-increment message id');
    }

    for (const term of tokenizeForIndex(parsed.content)) {
      await requestToPromise(
        termStore.put({ term, messageId: numericId, sessionId: parsed.sessionId } satisfies TermMessageRecord)
      );
    }

    if (options.touchSession) {
      const existingSessionRaw = await requestToPromise(sessionStore.get(parsed.sessionId));
      const now = Date.now();
      const baseSession: ChatSessionRecord = (() => {
        const existingParsed = StorageExportSchema.shape.sessions.element.safeParse(existingSessionRaw);
        if (existingParsed.success) {
          return {
            ...existingParsed.data,
            lastAccessedAt: now,
          };
        }
        return {
          sessionId: parsed.sessionId,
          keyword: '',
          conversationIndex: 0,
          createdAt: now,
          lastAccessedAt: now,
          kind: 'general',
          label: 'General',
          anchorKey: '',
        };
      })();
      await requestToPromise(sessionStore.put(baseSession));
    }

    await transactionDone(tx);
    return numericId;
  }

  async deleteMessage(messageId: number): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(['chat_messages', 'chat_term_messages'], 'readwrite');
    const messageStore = tx.objectStore('chat_messages');
    const termStore = tx.objectStore('chat_term_messages');

    const raw = await requestToPromise(messageStore.get(messageId));
    const parsed = StorageExportSchema.shape.messages.element.safeParse(raw);
    if (parsed.success) {
      for (const term of tokenizeForIndex(parsed.data.content)) {
        await requestToPromise(termStore.delete([term, messageId]));
      }
    }

    await requestToPromise(messageStore.delete(messageId));
    await transactionDone(tx);
  }

  async getMessages(sessionId: string, options: { limit?: number } = {}): Promise<ChatMessageRecordWithId[]> {
    const limit = typeof options.limit === 'number' && options.limit > 0 ? Math.floor(options.limit) : null;

    const db = await this.getDb();
    const tx = db.transaction('chat_messages', 'readonly');
    const store = tx.objectStore('chat_messages');
    const index = store.index('sessionId');
    const range = IDBKeyRange.only(sessionId);

    const results: ChatMessageRecordWithId[] = [];

    await new Promise<void>((resolve, reject) => {
      const request = index.openCursor(range, 'prev');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const parsed = StorageExportSchema.shape.messages.element.safeParse(cursor.value);
        if (parsed.success) results.push(parsed.data);

        if (limit !== null && results.length >= limit) {
          resolve();
          return;
        }
        cursor.continue();
      };
    });

    await transactionDone(tx);
    return results.reverse();
  }

  async listAllSessions(): Promise<ChatSessionRecord[]> {
    const db = await this.getDb();
    const tx = db.transaction('chat_sessions', 'readonly');
    const store = tx.objectStore('chat_sessions');
    const results: ChatSessionRecord[] = [];

    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const parsed = StorageExportSchema.shape.sessions.element.safeParse(cursor.value);
        if (parsed.success) results.push(parsed.data);
        cursor.continue();
      };
    });

    await transactionDone(tx);
    return results;
  }

  async listAllMessages(): Promise<ChatMessageRecordWithId[]> {
    const db = await this.getDb();
    const tx = db.transaction('chat_messages', 'readonly');
    const store = tx.objectStore('chat_messages');
    const results: ChatMessageRecordWithId[] = [];

    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const parsed = StorageExportSchema.shape.messages.element.safeParse(cursor.value);
        if (parsed.success) results.push(parsed.data);
        cursor.continue();
      };
    });

    await transactionDone(tx);
    return results;
  }

  // =============================================================================
  // Search (inverted index via chat_term_messages)
  // =============================================================================

  async searchMessages(query: string, options: { limit?: number } = {}): Promise<ChatMessageRecordWithId[]> {
    const limit = typeof options.limit === 'number' && options.limit > 0 ? Math.floor(options.limit) : 50;
    const allTerms = tokenizeForIndex(query).map(normalizeTerm);
    if (allTerms.length === 0) return [];
    const preferredTerms = allTerms.some((term) => term.length >= 2)
      ? allTerms.filter((term) => term.length >= 2)
      : allTerms;

    const db = await this.getDb();
    const tx = db.transaction(['chat_term_messages', 'chat_messages'], 'readonly');
    const termStore = tx.objectStore('chat_term_messages');
    const termIndex = termStore.index('term');
    const messageStore = tx.objectStore('chat_messages');

    const idsForTerm = async (term: string): Promise<Set<number>> => {
      const set = new Set<number>();
      await new Promise<void>((resolve, reject) => {
        const range = IDBKeyRange.only(term);
        const request = termIndex.openCursor(range);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          const value = cursor.value as TermMessageRecord;
          if (typeof value.messageId === 'number') set.add(value.messageId);
          cursor.continue();
        };
      });
      return set;
    };

    const resolveCandidateIds = async (terms: string[]): Promise<Set<number>> => {
      let candidateIds: Set<number> | null = null;
      for (const term of terms) {
        const termIds = await idsForTerm(term);
        if (!candidateIds) {
          candidateIds = termIds;
          continue;
        }
        for (const id of Array.from(candidateIds)) {
          if (!termIds.has(id)) candidateIds.delete(id);
        }
        if (candidateIds.size === 0) break;
      }
      return candidateIds ?? new Set<number>();
    };

    let candidateIds = await resolveCandidateIds(preferredTerms);
    if (candidateIds.size === 0 && preferredTerms !== allTerms) {
      candidateIds = await resolveCandidateIds(allTerms);
    }

    const ids = Array.from(candidateIds).sort((a, b) => b - a).slice(0, limit);
    const messages: ChatMessageRecordWithId[] = [];
    for (const id of ids) {
      const raw = await requestToPromise(messageStore.get(id));
      const parsed = StorageExportSchema.shape.messages.element.safeParse(raw);
      if (parsed.success) messages.push(parsed.data);
    }

    await transactionDone(tx);
    return messages.sort((a, b) => b.timestamp - a.timestamp);
  }

  async rebuildSearchIndex(): Promise<void> {
    const messages = await this.listAllMessages();
    const db = await this.getDb();
    const tx = db.transaction('chat_term_messages', 'readwrite');
    const store = tx.objectStore('chat_term_messages');

    await requestToPromise(store.clear());

    for (const msg of messages) {
      for (const term of tokenizeForIndex(msg.content)) {
        await requestToPromise(
          store.put({ term, messageId: msg.id, sessionId: msg.sessionId } satisfies TermMessageRecord)
        );
      }
    }

    await transactionDone(tx);
  }

  // =============================================================================
  // Export / Import
  // =============================================================================

  async exportAll(): Promise<StorageExportData> {
    const settings = (await this.getSettings()) ?? SettingsSchema.parse({});
    const sessions = await this.listAllSessions();
    const messages = await this.listAllMessages();
    const familiarity = await this.listWordFamiliarity();

    const payload: StorageExportData = {
      version: '1.0',
      exportedAt: Date.now(),
      settings,
      sessions,
      messages,
      familiarity,
    };

    return StorageExportSchema.parse(payload);
  }

  async importAll(raw: unknown, options: { strategy?: 'overwrite' | 'merge' } = {}): Promise<void> {
    const data = StorageExportSchema.parse(raw);
    const strategy = options.strategy ?? 'overwrite';

    const db = await this.getDb();
    const tx = db.transaction(['settings', 'chat_sessions', 'chat_messages', 'familiarity'], 'readwrite');
    const settingsStore = tx.objectStore('settings');
    const sessionStore = tx.objectStore('chat_sessions');
    const messageStore = tx.objectStore('chat_messages');
    const familiarityStore = tx.objectStore('familiarity');

    if (strategy === 'overwrite') {
      await requestToPromise(settingsStore.put({ key: 'settings', value: data.settings } satisfies SettingsRecord));

      for (const session of data.sessions) {
        await requestToPromise(sessionStore.put(session satisfies ChatSessionStoreRecord));
      }

      for (const message of data.messages) {
        const messageSchema = StorageExportSchema.shape.messages.element;
        const parsed = messageSchema.parse(message);
        await requestToPromise(messageStore.put(parsed satisfies ChatMessageStoreRecord));
      }

      for (const record of data.familiarity) {
        const parsed = WordFamiliaritySchema.parse(record);
        await requestToPromise(familiarityStore.put(parsed));
      }

      await transactionDone(tx);
      this.settingsCache = data.settings;
      await this.rebuildSearchIndex();
      return;
    }

    // Merge strategy: keep local settings; merge sessions/messages/familiarity.
    const existingSettings = await requestToPromise(settingsStore.get('settings'));
    if (!existingSettings) {
      await requestToPromise(settingsStore.put({ key: 'settings', value: data.settings } satisfies SettingsRecord));
      this.settingsCache = data.settings;
    }

    for (const session of data.sessions) {
      const existing = await requestToPromise(sessionStore.get(session.sessionId));
      const existingParsed = StorageExportSchema.shape.sessions.element.safeParse(existing);
      if (!existingParsed.success) {
        await requestToPromise(sessionStore.put(session satisfies ChatSessionStoreRecord));
        continue;
      }

      const merged: ChatSessionStoreRecord = {
        sessionId: session.sessionId,
        keyword: existingParsed.data.keyword?.trim() ? existingParsed.data.keyword : session.keyword,
        conversationIndex: Math.max(existingParsed.data.conversationIndex, session.conversationIndex),
        createdAt: Math.min(existingParsed.data.createdAt, session.createdAt),
        lastAccessedAt: Math.max(existingParsed.data.lastAccessedAt, session.lastAccessedAt),
        kind: existingParsed.data.kind ?? session.kind,
        label: existingParsed.data.label?.trim() ? existingParsed.data.label : session.label,
        anchorKey: existingParsed.data.anchorKey ?? session.anchorKey,
      };
      await requestToPromise(sessionStore.put(merged));
    }

    const existingMessagesByKey = new Map<string, ChatMessageRecordWithId>();
    await new Promise<void>((resolve, reject) => {
      const request = messageStore.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const parsed = StorageExportSchema.shape.messages.element.safeParse(cursor.value);
        if (parsed.success) {
          const key = messageDedupeKey(parsed.data);
          if (!existingMessagesByKey.has(key)) {
            existingMessagesByKey.set(key, parsed.data);
          }
        }
        cursor.continue();
      };
    });

    for (const message of data.messages) {
      const messageSchema = StorageExportSchema.shape.messages.element;
      const parsed = messageSchema.parse(message);
      const key = messageDedupeKey(parsed);
      const existing = existingMessagesByKey.get(key);
      const incomingThinking =
        typeof parsed.thinking === 'string' && parsed.thinking.trim() ? parsed.thinking : undefined;

      if (existing) {
        const existingThinking =
          typeof existing.thinking === 'string' && existing.thinking.trim() ? existing.thinking : undefined;
        const shouldUpdateThinking =
          incomingThinking && (!existingThinking || incomingThinking.length > existingThinking.length);

        if (shouldUpdateThinking) {
          const updated: ChatMessageStoreRecord = {
            ...existing,
            thinking: incomingThinking,
          };
          await requestToPromise(messageStore.put(updated));
          existingMessagesByKey.set(key, { ...existing, thinking: incomingThinking });
        }

        continue;
      }

      const record: ChatMessageStoreRecord = {
        sessionId: parsed.sessionId,
        role: parsed.role,
        content: parsed.content,
        ...(incomingThinking ? { thinking: incomingThinking } : {}),
        timestamp: parsed.timestamp,
      };
      const id = await requestToPromise(messageStore.add(record));
      const numericId = typeof id === 'number' ? id : Number(id);
      if (!Number.isFinite(numericId)) {
        throw new Error('Invalid auto-increment message id');
      }
      existingMessagesByKey.set(key, {
        id: numericId,
        sessionId: record.sessionId,
        role: record.role,
        content: record.content,
        ...(incomingThinking ? { thinking: incomingThinking } : {}),
        timestamp: record.timestamp,
      });
    }

    for (const record of data.familiarity) {
      const parsed = WordFamiliaritySchema.parse(record);
      const existing = await requestToPromise(familiarityStore.get(parsed.word));
      const existingParsed = WordFamiliaritySchema.safeParse(existing);
      if (!existingParsed.success) {
        await requestToPromise(familiarityStore.put(parsed));
        continue;
      }

      await requestToPromise(
        familiarityStore.put({
          word: parsed.word,
          familiarity: Math.max(existingParsed.data.familiarity, parsed.familiarity),
          lastSeen: Math.max(existingParsed.data.lastSeen, parsed.lastSeen),
          encounters: Math.max(existingParsed.data.encounters, parsed.encounters),
        }),
      );
    }

    await transactionDone(tx);
    await this.rebuildSearchIndex();
  }
}

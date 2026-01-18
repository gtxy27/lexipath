import { beforeEach, describe, expect, it, vi } from 'vitest';

// We unit-test the message handlers registered by registerStorageFeature.
// These tests intentionally mock out IndexedDB/storage and only verify:
// - correct handler wiring
// - retention settings application
// - deterministic export/import formatting

const getSettingsMock = vi.fn(async () => ({
  wordbook: { saveSnippetOnCapture: false, maxSourcesPerEntry: 1 },
}));

vi.mock('../../shared/storage', () => ({
  getSettings: getSettingsMock,
}));

type StorageServiceMock = {
  upsertWordbookEntry: ReturnType<typeof vi.fn>;
  getWordbookEntry: ReturnType<typeof vi.fn>;
  listWordbookEntries: ReturnType<typeof vi.fn>;
  deleteWordbookEntry: ReturnType<typeof vi.fn>;
  setWordbookEntryState: ReturnType<typeof vi.fn>;
  bulkSetWordbookEntryState: ReturnType<typeof vi.fn>;
};

const storageService: StorageServiceMock = {
  upsertWordbookEntry: vi.fn(async () => undefined),
  getWordbookEntry: vi.fn(async () => null),
  listWordbookEntries: vi.fn(async () => []),
  deleteWordbookEntry: vi.fn(async () => undefined),
  setWordbookEntryState: vi.fn(async () => null),
  bulkSetWordbookEntryState: vi.fn(async () => 0),
};

vi.mock('../../shared/storage-service', () => ({
  getStorageService: () => storageService,
}));

describe('storage feature: wordbook handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSettingsMock.mockResolvedValue({ wordbook: { saveSnippetOnCapture: false, maxSourcesPerEntry: 1 } });
  });

  it('WORDBOOK_UPSERT applies retention settings and returns stored entry', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123456);

    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    const entry = {
      id: 'en:hello',
      language: 'en',
      term: 'Hello',
      normalizedTerm: 'hello',
      state: 'active',
      tags: [],
      note: '',
      sources: [
        {
          kind: 'web',
          anchorKey: 'ak1',
          capturedAt: 1,
          snippet: 'S1',
          domain: 'example.com',
          title: 'Example',
        },
        {
          kind: 'subtitle',
          anchorKey: 'ak2',
          capturedAt: 2,
          snippet: 'S2',
          platform: 'youtube',
          timestampSec: 10,
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    };

    const expectedStored = {
      ...entry,
      sources: [
        {
          kind: 'web',
          anchorKey: 'ak1',
          capturedAt: 1,
          // snippet stripped because saveSnippetOnCapture=false
          snippet: undefined,
          domain: 'example.com',
          title: 'Example',
        },
      ],
      updatedAt: 123456,
    };

    storageService.getWordbookEntry.mockResolvedValueOnce(expectedStored);

    const result = await handlers.get('WORDBOOK_UPSERT')({ entry });

    expect(storageService.upsertWordbookEntry).toHaveBeenCalledTimes(1);
    expect(storageService.upsertWordbookEntry.mock.calls[0]?.[0]).toMatchObject({
      id: 'en:hello',
      sources: [expect.objectContaining({ anchorKey: 'ak1', snippet: undefined })],
      updatedAt: 123456,
    });

    expect(storageService.getWordbookEntry).toHaveBeenCalledWith('en:hello');
    expect(result).toEqual(expectedStored);
  }, 15_000);

  it('WORDBOOK_UPSERT throws MessageError when stored entry missing', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(10);

    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    const entry = {
      id: 'en:hello',
      language: 'en',
      term: 'Hello',
      normalizedTerm: 'hello',
      state: 'active',
      tags: [],
      note: '',
      sources: [],
      createdAt: 1,
      updatedAt: 2,
    };

    storageService.getWordbookEntry.mockResolvedValueOnce(null);

    await expect(handlers.get('WORDBOOK_UPSERT')({ entry })).rejects.toMatchObject({
      name: 'MessageError',
      code: 'WORDBOOK_UPSERT_FAILED',
    });
  });

  it('WORDBOOK_LIST forwards query/state/sort/limit to storage', async () => {
    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    storageService.listWordbookEntries.mockResolvedValueOnce([{ id: 'en:a' } as any]);

    const result = await handlers.get('WORDBOOK_LIST')({
      query: 'hello',
      state: 'archived',
      limit: 10,
      sort: 'term_asc',
    });

    expect(storageService.listWordbookEntries).toHaveBeenCalledWith({
      query: 'hello',
      state: 'archived',
      limit: 10,
      sort: 'term_asc',
    });
    expect(result).toEqual([{ id: 'en:a' }]);
  });

  it('WORDBOOK_EXPORT supports json/anki_csv/markdown formats', async () => {
    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    storageService.listWordbookEntries.mockResolvedValue([
      {
        id: 'en:he"llo',
        language: 'en',
        term: 'he"llo',
        normalizedTerm: 'he"llo',
        state: 'active',
        tags: ['t1', 't2'],
        note: 'n1',
        sources: [],
        createdAt: 1,
        updatedAt: 2,
      },
    ] as any);

    const json = await handlers.get('WORDBOOK_EXPORT')({ format: 'json' });
    expect(json.format).toBe('json');
    expect(json.filename).toBe('lexipath-wordbook.json');
    expect(JSON.parse(json.content)).toHaveLength(1);

    const csv = await handlers.get('WORDBOOK_EXPORT')({ format: 'anki_csv' });
    expect(csv.format).toBe('anki_csv');
    expect(csv.filename).toBe('lexipath-wordbook.csv');
    expect(csv.content.split('\n')[0]).toBe('term,language,note,tags');
    expect(csv.content).toContain('"he""llo"');

    const md = await handlers.get('WORDBOOK_EXPORT')({ format: 'markdown' });
    expect(md.format).toBe('markdown');
    expect(md.filename).toBe('lexipath-wordbook.md');
    expect(md.content).toContain('- **he"llo** (en)');
    expect(md.content).toContain('Tags: t1, t2');
    expect(md.content).toContain('Note: n1');
  });

  it('WORDBOOK_IMPORT (json) rejects invalid JSON', async () => {
    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    await expect(
      handlers.get('WORDBOOK_IMPORT')({ format: 'json', data: '{not json', strategy: 'merge' })
    ).rejects.toMatchObject({ name: 'MessageError', code: 'INVALID_PAYLOAD' });
  });

  it('WORDBOOK_IMPORT (json) merge keeps existing note and merges tags', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(999);

    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    const existing = {
      id: 'en:hello',
      language: 'en',
      term: 'Hello',
      normalizedTerm: 'hello',
      state: 'active',
      tags: ['t1'],
      note: 'keep me',
      sources: [
        {
          kind: 'web',
          anchorKey: 'ak1',
          capturedAt: 1,
          snippet: 'existing snippet',
          domain: 'example.com',
          title: 'Example',
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    };

    storageService.getWordbookEntry.mockResolvedValueOnce(existing);

    const payloadData = JSON.stringify([
      {
        id: 'en:hello',
        language: 'en',
        term: 'Hello',
        normalizedTerm: 'hello',
        tags: ['t2'],
        note: 'should not overwrite',
        sources: [
          {
            kind: 'web',
            anchorKey: 'ak2',
            capturedAt: 2,
            snippet: 'incoming snippet',
            domain: 'example.org',
            title: 'Example 2',
          },
        ],
        createdAt: 1,
        updatedAt: 2,
      },
    ]);

    const result = await handlers.get('WORDBOOK_IMPORT')({ format: 'json', data: payloadData, strategy: 'merge' });

    expect(result).toEqual({ added: 0, updated: 1, skipped: 0 });

    expect(storageService.upsertWordbookEntry).toHaveBeenCalledTimes(1);
    const merged = storageService.upsertWordbookEntry.mock.calls[0]?.[0];
    expect(merged.note).toBe('keep me');
    expect(merged.tags.sort()).toEqual(['t1', 't2']);
    // maxSourcesPerEntry=1 => keep the first (existing) source
    expect(merged.sources).toHaveLength(1);
    expect(merged.sources[0].anchorKey).toBe('ak1');
    expect(merged.updatedAt).toBe(999);
  });

  it('WORDBOOK_IMPORT (anki_csv) adds new entries and returns counts', async () => {
    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    storageService.getWordbookEntry.mockResolvedValueOnce(null);

    const csv = ['term,language,note,tags', '"Hello",en,Note,t1 t2'].join('\n');

    const result = await handlers.get('WORDBOOK_IMPORT')({ format: 'anki_csv', data: csv, strategy: 'merge' });

    expect(result).toEqual({ added: 1, updated: 0, skipped: 0 });
    expect(storageService.upsertWordbookEntry).toHaveBeenCalledTimes(1);
    const inserted = storageService.upsertWordbookEntry.mock.calls[0]?.[0];
    expect(inserted.id).toBe('en:hello');
    expect(inserted.term).toBe('Hello');
    expect(inserted.tags.sort()).toEqual(['t1', 't2']);
  });

  it('WORDBOOK_GET forwards id to storage', async () => {
    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    storageService.getWordbookEntry.mockResolvedValueOnce({ id: 'en:hello' } as any);

    const result = await handlers.get('WORDBOOK_GET')({ id: 'en:hello' });

    expect(storageService.getWordbookEntry).toHaveBeenCalledWith('en:hello');
    expect(result).toEqual({ id: 'en:hello' });
  });

  it('WORDBOOK_DELETE deletes entry and returns ok', async () => {
    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    const result = await handlers.get('WORDBOOK_DELETE')({ id: 'en:hello' });

    expect(storageService.deleteWordbookEntry).toHaveBeenCalledWith('en:hello');
    expect(result).toEqual({ ok: true });
  });

  it('WORDBOOK_SET_STATE forwards id/state and returns updated entry', async () => {
    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    storageService.setWordbookEntryState.mockResolvedValueOnce({ id: 'en:hello', state: 'archived' } as any);

    const result = await handlers.get('WORDBOOK_SET_STATE')({ id: 'en:hello', state: 'archived' });

    expect(storageService.setWordbookEntryState).toHaveBeenCalledWith('en:hello', 'archived');
    expect(result).toEqual({ id: 'en:hello', state: 'archived' });
  });

  it('WORDBOOK_BULK_SET_STATE forwards ids/state and returns updated count', async () => {
    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    storageService.bulkSetWordbookEntryState.mockResolvedValueOnce(3);

    const result = await handlers.get('WORDBOOK_BULK_SET_STATE')({ ids: ['a', 'b', 'c'], state: 'ignored' });

    expect(storageService.bulkSetWordbookEntryState).toHaveBeenCalledWith(['a', 'b', 'c'], 'ignored');
    expect(result).toEqual({ updated: 3 });
  });

  it('WORDBOOK_EXPORT with ids uses getWordbookEntry and filters missing entries', async () => {
    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    storageService.getWordbookEntry
      .mockResolvedValueOnce({ id: 'en:a', language: 'en', term: 'a', normalizedTerm: 'a', state: 'active', tags: [], note: '', sources: [], createdAt: 1, updatedAt: 1 } as any)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'en:c', language: 'en', term: 'c', normalizedTerm: 'c', state: 'active', tags: [], note: '', sources: [], createdAt: 1, updatedAt: 1 } as any);

    const result = await handlers.get('WORDBOOK_EXPORT')({ format: 'json', ids: ['en:a', 'en:missing', 'en:c'] });

    expect(storageService.getWordbookEntry).toHaveBeenCalledTimes(3);
    const rows = JSON.parse(result.content);
    expect(rows.map((r: any) => r.id)).toEqual(['en:a', 'en:c']);
  });

  it('WORDBOOK_IMPORT (json) skip-duplicates does not upsert existing', async () => {
    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    storageService.getWordbookEntry.mockResolvedValueOnce({ id: 'en:hello' } as any);

    const payloadData = JSON.stringify([{ id: 'en:hello', language: 'en', term: 'Hello', normalizedTerm: 'hello', state: 'active', tags: [], note: '', sources: [], createdAt: 1, updatedAt: 1 }]);

    const result = await handlers.get('WORDBOOK_IMPORT')({ format: 'json', data: payloadData, strategy: 'skip-duplicates' });

    expect(result).toEqual({ added: 0, updated: 0, skipped: 1 });
    expect(storageService.upsertWordbookEntry).toHaveBeenCalledTimes(0);
  });

  it('WORDBOOK_IMPORT (anki_csv) skip-duplicates does not upsert existing', async () => {
    const { registerStorageFeature } = await import('./storage');

    const handlers = new Map<string, any>();
    const registry = {
      register: vi.fn((type: string, fn: any) => handlers.set(type, fn)),
    } as any;

    registerStorageFeature({ registry });

    storageService.getWordbookEntry.mockResolvedValueOnce({ id: 'en:hello' } as any);

    const csv = ['term,language,note,tags', '"Hello",en,Note,t1'].join('\n');

    const result = await handlers.get('WORDBOOK_IMPORT')({ format: 'anki_csv', data: csv, strategy: 'skip-duplicates' });

    expect(result).toEqual({ added: 0, updated: 0, skipped: 1 });
    expect(storageService.upsertWordbookEntry).toHaveBeenCalledTimes(0);
  });
});

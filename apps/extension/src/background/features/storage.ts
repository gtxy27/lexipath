import { WebDAVProvider } from '@lexipath/storage';

import { MessageError, type createMessageHandlerRegistry } from '../../shared/messages';
import { recordExposureValid } from '../../shared/familiarity';
import { getStorageService } from '../../shared/storage-service';
import { getSettings } from '../../shared/storage';
import { bumpDailyUsage } from '../usage-summary';


type Registry = ReturnType<typeof createMessageHandlerRegistry>;

export function registerStorageFeature(options: { registry: Registry }) {
  const { registry } = options;

  registry.register('EXPORT_DATA', async () => {
    const storageService = getStorageService();
    return storageService.exportAll();
  });

  registry.register('IMPORT_DATA', async (payload) => {
    const storageService = getStorageService();
    await storageService.importAll(payload);
    return { ok: true };
  });

  registry.register('SEARCH_MESSAGES', async (payload) => {
    const storageService = getStorageService();
    const limitOption = typeof payload.limit === 'number' ? { limit: payload.limit } : {};
    return storageService.searchMessages(payload.query, limitOption);
  });

  registry.register('TEST_WEBDAV_CONNECTION', async (payload) => {
    const provider = new WebDAVProvider(payload);
    const result = await provider.testConnection();
    if (result.ok) return { ok: true };
    throw new MessageError(result.error);
  });

  registry.register('WEBDAV_UPLOAD', async (payload) => {
    const storageService = getStorageService();
    const data = await storageService.exportAll();
    const provider = new WebDAVProvider(payload);
    const result = await provider.upload(data);
    if (!result.ok) {
      throw new MessageError(result.error);
    }
    return { ok: true };
  });

  registry.register('WEBDAV_DOWNLOAD', async (payload) => {
    const provider = new WebDAVProvider(payload);
    const result = await provider.download();
    if (!result.ok) {
      throw new MessageError(result.error);
    }
    if (result.value) {
      const storageService = getStorageService();
      await storageService.importAll(result.value, { strategy: 'merge' });
    }
    return { ok: true };
  });

  registry.register('BATCH_GET_WORD_FAMILIARITY', async (payload: { words: string[] }) => {
    const words = payload.words.map((w) => w.trim().toLowerCase()).filter(Boolean);
    if (words.length === 0) return [];

    const storageService = getStorageService();
    const records = await storageService.batchGetWordFamiliarity(Array.from(new Set(words)));
    return Array.from(records.values());
  });

  registry.register('RECORD_EXPOSURE_VALID', async (payload: { words: string[] }) => {
    const words = payload.words.map((w) => w.trim()).filter(Boolean);
    if (words.length === 0) return null;
    await Promise.all(words.map((word) => recordExposureValid(word)));
    void bumpDailyUsage({ task: 'exposure_valid', words: words.length, apiEvent: false });
    return null;
  });

  // ---------------------------------------------------------------------------
  // Wordbook
  // ---------------------------------------------------------------------------

  registry.register('WORDBOOK_UPSERT', async (payload) => {
    const storageService = getStorageService();
    const settings = await getSettings();

    const entry = payload.entry;
    const maxSources = settings.wordbook?.maxSourcesPerEntry ?? 2;
    const saveSnippet = settings.wordbook?.saveSnippetOnCapture ?? true;

    // Apply current retention settings to the provided entry.
    const normalizedSources = Array.isArray(entry.sources)
      ? entry.sources.map((s) => (saveSnippet ? s : { ...s, snippet: undefined }))
      : [];

    const next = {
      ...entry,
      sources: normalizedSources.slice(0, Math.max(1, Math.min(3, maxSources))),
      updatedAt: Date.now(),
    };

    await storageService.upsertWordbookEntry(next as any);
    const stored = await storageService.getWordbookEntry(entry.id);
    if (!stored) throw new MessageError({ code: 'WORDBOOK_UPSERT_FAILED', message: 'Failed to upsert wordbook entry' });
    return stored;
  });

  registry.register('WORDBOOK_GET', async (payload) => {
    const storageService = getStorageService();
    return storageService.getWordbookEntry(payload.id);
  });

  registry.register('WORDBOOK_LIST', async (payload) => {
    const storageService = getStorageService();
    const query = payload?.query;
    const state = (payload as any)?.state;
    const limit = payload?.limit;
    const sort = (payload as any)?.sort;
    return storageService.listWordbookEntries({
      ...(typeof query === 'string' ? { query } : {}),
      ...(state ? { state } : {}),
      ...(typeof limit === 'number' ? { limit } : {}),
      ...(sort ? { sort } : {}),
    } as any);
  });

  registry.register('WORDBOOK_DELETE', async (payload) => {
    const storageService = getStorageService();
    await storageService.deleteWordbookEntry(payload.id);
    return { ok: true };
  });

  registry.register('WORDBOOK_SET_STATE', async (payload) => {
    const storageService = getStorageService();
    return storageService.setWordbookEntryState(payload.id, payload.state as any);
  });

  registry.register('WORDBOOK_BULK_SET_STATE', async (payload) => {
    const storageService = getStorageService();
    const updated = await storageService.bulkSetWordbookEntryState(payload.ids, payload.state as any);
    return { updated };
  });

  registry.register('WORDBOOK_EXPORT', async (payload) => {
    const storageService = getStorageService();
    const entries = payload.ids?.length
      ? await Promise.all(payload.ids.map((id) => storageService.getWordbookEntry(id)))
      : await storageService.listWordbookEntries({ limit: 2000, sort: 'updated_desc' });

    const rows = (payload.ids?.length ? entries.filter(Boolean) : entries) as any[];

    if (payload.format === 'json') {
      return {
        format: 'json',
        filename: 'lexipath-wordbook.json',
        mime: 'application/json',
        content: JSON.stringify(rows, null, 2),
      };
    }

    if (payload.format === 'anki_csv') {
      const header = ['term', 'language', 'note', 'tags'].join(',');
      const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = rows.map((e) => [escape(e.term), escape(e.language), escape(e.note ?? ''), escape((e.tags ?? []).join(' '))].join(','));
      return {
        format: 'anki_csv',
        filename: 'lexipath-wordbook.csv',
        mime: 'text/csv',
        content: [header, ...lines].join('\n'),
      };
    }

    // markdown
    const md = rows
      .map((e) => {
        const tags = (e.tags ?? []).length ? `\n\nTags: ${(e.tags ?? []).join(', ')}` : '';
        const note = e.note?.trim() ? `\n\nNote: ${e.note.trim()}` : '';
        return `- **${e.term}** (${e.language})${tags}${note}`;
      })
      .join('\n');

    return {
      format: 'markdown',
      filename: 'lexipath-wordbook.md',
      mime: 'text/markdown',
      content: md,
    };
  });

  registry.register('WORDBOOK_IMPORT', async (payload) => {
    const storageService = getStorageService();
    const settings = await getSettings();

    const strategy = payload.strategy ?? 'merge';
    const maxSources = settings.wordbook?.maxSourcesPerEntry ?? 2;
    const saveSnippet = settings.wordbook?.saveSnippetOnCapture ?? true;

    let added = 0;
    let updated = 0;
    let skipped = 0;

    if (payload.format === 'json') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload.data);
      } catch {
        throw new MessageError({ code: 'INVALID_PAYLOAD', message: 'Invalid JSON' });
      }
      if (!Array.isArray(parsed)) {
        throw new MessageError({ code: 'INVALID_PAYLOAD', message: 'Expected JSON array' });
      }

      for (const raw of parsed) {
        const incoming = raw as any;
        const id = String(incoming.id ?? '');
        if (!id) continue;
        const existing = await storageService.getWordbookEntry(id);

        if (existing && strategy === 'skip-duplicates') {
          skipped += 1;
          continue;
        }

        if (existing && strategy === 'merge') {
          const merged = {
            ...existing,
            ...(incoming.term ? { term: String(incoming.term) } : {}),
            ...(Array.isArray(incoming.tags) ? { tags: Array.from(new Set([...(existing.tags ?? []), ...incoming.tags.map((t: any) => String(t ?? '').trim()).filter(Boolean)])) } : {}),
            ...(existing.note?.trim() ? {} : { note: String(incoming.note ?? '') }),
            sources: (saveSnippet ? [...(existing.sources ?? []), ...(incoming.sources ?? [])] : [...(existing.sources ?? []), ...(incoming.sources ?? []).map((s: any) => ({ ...s, snippet: undefined }))]).slice(0, Math.max(1, Math.min(3, maxSources))),
            updatedAt: Date.now(),
          };
          await storageService.upsertWordbookEntry(merged as any);
          updated += 1;
          continue;
        }

        // overwrite or new
        const normalizedSources = saveSnippet ? incoming.sources ?? [] : (incoming.sources ?? []).map((s: any) => ({ ...s, snippet: undefined }));
        const next = {
          ...incoming,
          sources: Array.isArray(normalizedSources) ? normalizedSources.slice(0, Math.max(1, Math.min(3, maxSources))) : [],
          updatedAt: Date.now(),
        };
        await storageService.upsertWordbookEntry(next as any);
        if (existing) updated += 1;
        else added += 1;
      }

      return { added, updated, skipped };
    }

    // CSV import: expect header term,language,note,tags (any order; first row header)
    const text = payload.data;
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length <= 1) return { added: 0, updated: 0, skipped: 0 };

    const headerLine = lines[0] ?? '';
    const header = headerLine.split(',').map((h) => h.trim().toLowerCase());
    const idxTerm = header.indexOf('term');
    const idxLang = header.indexOf('language');
    const idxNote = header.indexOf('note');
    const idxTags = header.indexOf('tags');
    if (idxTerm < 0 || idxLang < 0) {
      throw new MessageError({ code: 'INVALID_PAYLOAD', message: 'CSV must include term and language columns' });
    }

    for (const line of lines.slice(1)) {
      const cols = line.split(',').map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"'));
      const term = (cols[idxTerm] ?? '').trim();
      const language = (cols[idxLang] ?? '').trim();
      if (!term || !language) continue;

      const normalizedTerm = term.trim().toLowerCase();
      const id = `${language}:${normalizedTerm}`;
      const existing = await storageService.getWordbookEntry(id);

      if (existing && strategy === 'skip-duplicates') {
        skipped += 1;
        continue;
      }

      const incoming = {
        id,
        language,
        term,
        normalizedTerm,
        state: 'active',
        tags: (idxTags >= 0 ? (cols[idxTags] ?? '') : '').split(/\s+/).map((t) => t.trim()).filter(Boolean),
        note: idxNote >= 0 ? (cols[idxNote] ?? '') : '',
        sources: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      if (existing && strategy === 'merge') {
        const merged = {
          ...existing,
          tags: Array.from(new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])),
          note: existing.note?.trim() ? existing.note : incoming.note,
          updatedAt: Date.now(),
        };
        await storageService.upsertWordbookEntry(merged as any);
        updated += 1;
        continue;
      }

      // overwrite or new
      await storageService.upsertWordbookEntry(incoming as any);
      if (existing) updated += 1;
      else added += 1;
    }

    return { added, updated, skipped };
  });
}



import browser from 'webextension-polyfill';
import { WordFamiliaritySchema, type WordFamiliarity } from '@lexipath/core';
import { createLogger, getErrorMessage } from '@lexipath/core/log';
import {
  createInitialWordFamiliarity,
  normalizeWordForFamiliarity,
  recordWordEncounter,
  recordWordFavorited,
  recordWordLearned,
  setWordFamiliarity,
} from '@lexipath/core/familiarity';
import { getStorageService } from './storage-service';

const WORD_FAMILIARITY_PREFIX = 'wordFamiliarity:';
const log = createLogger('shared:familiarity');

function storageKeyForWord(normalizedWord: string): string {
  return `${WORD_FAMILIARITY_PREFIX}${normalizedWord}`;
}

function createWordQueue() {
  const chains = new Map<string, Promise<unknown>>();

  function enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    const next = previous.then(work, work);

    const nextWithCleanup = next.finally(() => {
      if (chains.get(key) === nextWithCleanup) chains.delete(key);
    });

    chains.set(key, nextWithCleanup);
    return next;
  }

  return { enqueue };
}

const wordQueue = createWordQueue();

let familiarityMigrationPromise: Promise<void> | null = null;
let familiarityMigrated = false;

async function ensureFamiliarityMigrated(): Promise<void> {
  if (familiarityMigrated) return;
  if (familiarityMigrationPromise) return familiarityMigrationPromise;

  familiarityMigrationPromise = (async () => {
    const storageService = getStorageService();

    try {
      const already = await storageService.getMeta('migration_familiarity_v1');
      if (already) {
        familiarityMigrated = true;
        return;
      }
    } catch (error: unknown) {
      log.warn('Familiarity migration meta read failed; continuing with migration', { message: getErrorMessage(error) });
    }

    let stored: Record<string, unknown> = {};
    try {
      stored = (await browser.storage.local.get(null)) as Record<string, unknown>;
    } catch (error: unknown) {
      log.warn('Failed to read legacy familiarity records from browser.storage.local; continuing', {
        message: getErrorMessage(error),
      });
      stored = {};
    }

    const keysToRemove: string[] = [];
    const records: WordFamiliarity[] = [];

    for (const [key, value] of Object.entries(stored)) {
      if (!key.startsWith(WORD_FAMILIARITY_PREFIX)) continue;
      keysToRemove.push(key);

      const parsed = WordFamiliaritySchema.safeParse(value);
      if (parsed.success) {
        records.push(parsed.data);
      }
    }

    for (const record of records) {
      await storageService.upsertWordFamiliarity(record);
    }

    if (keysToRemove.length > 0) {
      try {
        await browser.storage.local.remove(keysToRemove);
      } catch (error: unknown) {
        log.warn('Failed to remove legacy familiarity keys from browser.storage.local; continuing', {
          count: keysToRemove.length,
          message: getErrorMessage(error),
        });
      }
    }

    try {
      await storageService.setMeta('migration_familiarity_v1', true);
    } catch (error: unknown) {
      log.warn('Failed to persist familiarity migration meta flag; migration may rerun', { message: getErrorMessage(error) });
    }

    familiarityMigrated = true;
  })().finally(() => {
    familiarityMigrationPromise = null;
  });

  return familiarityMigrationPromise;
}

async function readWordRecord(normalizedWord: string): Promise<WordFamiliarity | null> {
  await ensureFamiliarityMigrated();

  const storageService = getStorageService();
  const record = await storageService.getWordFamiliarity(normalizedWord);
  if (record) return record;

  const key = storageKeyForWord(normalizedWord);
  try {
    const stored = (await browser.storage.local.get(key)) as Record<string, unknown>;
    const raw = stored[key];
    if (!raw) return null;

    const parsed = WordFamiliaritySchema.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch (error: unknown) {
    log.warn('Failed to read legacy familiarity record from browser.storage.local; ignoring record', {
      key,
      message: getErrorMessage(error),
    });
  }

  return null;
}

async function writeWordRecord(record: WordFamiliarity): Promise<void> {
  const normalizedWord = normalizeWordForFamiliarity(record.word);
  if (!normalizedWord) return;

  await ensureFamiliarityMigrated();
  await getStorageService().upsertWordFamiliarity(record);
}

export async function getFamiliarity(word: string): Promise<number> {
  const normalizedWord = normalizeWordForFamiliarity(word);
  if (!normalizedWord) return 0;

  const record = await readWordRecord(normalizedWord);
  return record?.familiarity ?? 0;
}

export async function batchGetFamiliarity(words: string[]): Promise<Map<string, number>> {
  const normalizedWords = Array.from(
    new Set(words.map(normalizeWordForFamiliarity).filter(Boolean))
  );

  await ensureFamiliarityMigrated();
  const storageService = getStorageService();

  const result = new Map<string, number>();

  const records = await storageService.batchGetWordFamiliarity(normalizedWords);
  for (const normalizedWord of normalizedWords) {
    const record = records.get(normalizedWord);
    result.set(normalizedWord, record?.familiarity ?? 0);
  }

  return result;
}

export async function recordLookup(word: string): Promise<void> {
  const normalizedWord = normalizeWordForFamiliarity(word);
  if (!normalizedWord) return;

  await wordQueue.enqueue(normalizedWord, async () => {
    const existing = await readWordRecord(normalizedWord);
    const record = existing ?? createInitialWordFamiliarity(normalizedWord);
    const encountered = recordWordEncounter(record);
    // plan15: LOOKUP_MANUAL should strongly bias toward "unknown".
    const updated = setWordFamiliarity(encountered, 0);
    await writeWordRecord(updated);
  });
}

// plan15: explicit event names for clarity.
export async function recordLookupManual(word: string): Promise<void> {
  return recordLookup(word);
}

export async function recordExposureValid(word: string): Promise<void> {
  const normalizedWord = normalizeWordForFamiliarity(word);
  if (!normalizedWord) return;

  await wordQueue.enqueue(normalizedWord, async () => {
    const existing = await readWordRecord(normalizedWord);
    const record = existing ?? createInitialWordFamiliarity(normalizedWord);
    const updated = recordWordEncounter(record);
    await writeWordRecord(updated);
  });
}

export async function recordFavorited(word: string): Promise<void> {
  const normalizedWord = normalizeWordForFamiliarity(word);
  if (!normalizedWord) return;

  await wordQueue.enqueue(normalizedWord, async () => {
    const existing = await readWordRecord(normalizedWord);
    const record = existing ?? createInitialWordFamiliarity(normalizedWord);
    const updated = recordWordFavorited(record);
    await writeWordRecord(updated);
  });
}

export async function recordLearned(word: string): Promise<void> {
  const normalizedWord = normalizeWordForFamiliarity(word);
  if (!normalizedWord) return;

  await wordQueue.enqueue(normalizedWord, async () => {
    const existing = await readWordRecord(normalizedWord);
    const record = existing ?? createInitialWordFamiliarity(normalizedWord);
    const updated = recordWordLearned(record);
    await writeWordRecord(updated);
  });
}

export async function updateFamiliarity(word: string, familiarity: number): Promise<void> {
  const normalizedWord = normalizeWordForFamiliarity(word);
  if (!normalizedWord) return;

  await wordQueue.enqueue(normalizedWord, async () => {
    const existing = await readWordRecord(normalizedWord);
    const record = existing ?? createInitialWordFamiliarity(normalizedWord);
    const updated = setWordFamiliarity(record, familiarity);
    await writeWordRecord(updated);
  });
}

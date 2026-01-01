import browser from 'webextension-polyfill';
import { WordFamiliaritySchema, type WordFamiliarity } from '@lexipath/core';
import {
  createInitialWordFamiliarity,
  normalizeWordForFamiliarity,
  recordWordEncounter,
  recordWordFavorited,
  recordWordLearned,
  setWordFamiliarity,
} from '@lexipath/core/familiarity';

const WORD_FAMILIARITY_PREFIX = 'wordFamiliarity:';

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

async function readWordRecord(normalizedWord: string): Promise<WordFamiliarity | null> {
  const key = storageKeyForWord(normalizedWord);
  const stored = await browser.storage.local.get(key);
  const raw = stored[key];
  if (!raw) return null;

  const parsed = WordFamiliaritySchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  console.warn(`[LexiPath] Invalid familiarity record for "${normalizedWord}", ignoring`);
  return null;
}

async function writeWordRecord(record: WordFamiliarity): Promise<void> {
  const normalizedWord = normalizeWordForFamiliarity(record.word);
  if (!normalizedWord) return;

  const key = storageKeyForWord(normalizedWord);
  await browser.storage.local.set({ [key]: record });
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

  const keys = normalizedWords.map(storageKeyForWord);
  const stored = keys.length > 0 ? await browser.storage.local.get(keys) : {};

  const result = new Map<string, number>();
  for (const normalizedWord of normalizedWords) {
    const raw = stored[storageKeyForWord(normalizedWord)];
    const parsed = WordFamiliaritySchema.safeParse(raw);
    result.set(normalizedWord, parsed.success ? parsed.data.familiarity : 0);
  }
  return result;
}

export async function recordLookup(word: string): Promise<void> {
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


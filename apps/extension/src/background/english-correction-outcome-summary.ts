import browser from 'webextension-polyfill';
import { createLogger, getErrorMessage } from '@lexipath/core/log';

export type EnglishCorrectionOutcomeBucket = {
  requests: number;
  correct: number;
  incorrect: number;
};

export type DailyEnglishCorrectionOutcomeSummary = {
  date: string; // YYYY-MM-DD (local)
  updatedAt: number;
  totals: EnglishCorrectionOutcomeBucket;
};

type OutcomeStore = {
  version: 1;
  byDate: Record<string, DailyEnglishCorrectionOutcomeSummary>;
};

const log = createLogger('background:english-correction-outcome');
const STORAGE_KEY = 'lexipath_english_correction_outcomes_v1';
const STORE_VERSION = 1 as const;

let opChain: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = opChain.then(fn, fn);
  opChain = next.catch(() => undefined);
  return next;
}

function toLocalDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function emptyBucket(): EnglishCorrectionOutcomeBucket {
  return { requests: 0, correct: 0, incorrect: 0 };
}

function addToBucket(
  bucket: EnglishCorrectionOutcomeBucket,
  delta: Partial<EnglishCorrectionOutcomeBucket>
): EnglishCorrectionOutcomeBucket {
  return {
    requests: bucket.requests + (delta.requests ?? 0),
    correct: bucket.correct + (delta.correct ?? 0),
    incorrect: bucket.incorrect + (delta.incorrect ?? 0),
  };
}

function normalizeStore(raw: unknown): OutcomeStore {
  if (!raw || typeof raw !== 'object') return { version: STORE_VERSION, byDate: {} };
  const record = raw as Record<string, unknown>;
  const byDate = record.byDate && typeof record.byDate === 'object' ? (record.byDate as Record<string, DailyEnglishCorrectionOutcomeSummary>) : {};
  return { version: STORE_VERSION, byDate };
}

function pruneOldDays(store: OutcomeStore) {
  // Intentionally keep forever. This store grows by at most 1 record per day.
  void store;
}

async function loadStore(): Promise<OutcomeStore> {
  const raw = await browser.storage.local.get(STORAGE_KEY);
  return normalizeStore((raw as Record<string, unknown>)[STORAGE_KEY]);
}

async function saveStore(store: OutcomeStore): Promise<void> {
  pruneOldDays(store);
  await browser.storage.local.set({ [STORAGE_KEY]: store });
}

export function bumpEnglishCorrectionOutcome(event: {
  date?: string;
  hasError: boolean;
}): Promise<void> {
  return withLock(async () => {
    const dateKey = typeof event.date === 'string' && event.date.trim() ? event.date : toLocalDateKey(new Date());

    const delta: Partial<EnglishCorrectionOutcomeBucket> = { requests: 1 };
    if (event.hasError) {
      delta.incorrect = 1;
    } else {
      delta.correct = 1;
    }

    try {
      const store = await loadStore();
      const day =
        store.byDate[dateKey] ??
        ({
          date: dateKey,
          updatedAt: Date.now(),
          totals: emptyBucket(),
        } satisfies DailyEnglishCorrectionOutcomeSummary);

      day.updatedAt = Date.now();
      day.totals = addToBucket(day.totals, delta);
      store.byDate[dateKey] = day;

      await saveStore(store);
    } catch (error: unknown) {
      log.debug('Failed to bump english correction outcome', { message: getErrorMessage(error), event });
    }
  });
}

export async function getEnglishCorrectionOutcomeSummary(options?: {
  days?: number;
}): Promise<{ today: DailyEnglishCorrectionOutcomeSummary; recentDays: DailyEnglishCorrectionOutcomeSummary[] }> {
  const requestedDays = options?.days ?? 7;
  const days = Number.isFinite(requestedDays) ? Math.max(1, Math.min(365, Math.floor(requestedDays))) : 7;

  const store = await loadStore();
  const todayKey = toLocalDateKey(new Date());
  const today =
    store.byDate[todayKey] ??
    ({
      date: todayKey,
      updatedAt: Date.now(),
      totals: emptyBucket(),
    } satisfies DailyEnglishCorrectionOutcomeSummary);

  const sortedKeys = Object.keys(store.byDate).sort().reverse();
  const recentDays = sortedKeys
    .filter((key) => typeof key === 'string' && key.trim())
    .slice(0, days)
    .map((key) => store.byDate[key])
    .filter((day): day is DailyEnglishCorrectionOutcomeSummary => Boolean(day));

  return { today, recentDays };
}

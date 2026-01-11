import browser from 'webextension-polyfill';
import { createLogger, getErrorMessage } from '@lexipath/core/log';

export type UsageBucket = {
  events: number;
  apiEvents: number;
  words: number;
};

export type DailyUsageSummary = {
  date: string; // YYYY-MM-DD (local)
  updatedAt: number;
  totals: UsageBucket;
  tasks: Record<string, UsageBucket>;
  providers: Record<string, UsageBucket>;
};

type UsageStore = {
  version: 3;
  byDate: Record<string, DailyUsageSummary>;
};

const log = createLogger('background:usage-summary');
const STORAGE_KEY = 'lexipath_usage_summary_v3';
const STORE_VERSION = 3 as const;
const KEEP_DAYS = 30;

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

function emptyBucket(): UsageBucket {
  return { events: 0, apiEvents: 0, words: 0 };
}

function addToBucket(bucket: UsageBucket, delta: Partial<UsageBucket>): UsageBucket {
  return {
    events: bucket.events + (delta.events ?? 0),
    apiEvents: bucket.apiEvents + (delta.apiEvents ?? 0),
    words: bucket.words + (delta.words ?? 0),
  };
}

function normalizeStore(raw: unknown): UsageStore {
  if (!raw || typeof raw !== 'object') return { version: STORE_VERSION, byDate: {} };
  const record = raw as Record<string, unknown>;
  const version = record.version === STORE_VERSION ? STORE_VERSION : STORE_VERSION;
  const byDate = record.byDate && typeof record.byDate === 'object' ? (record.byDate as Record<string, DailyUsageSummary>) : {};
  return { version, byDate };
}

function pruneOldDays(store: UsageStore) {
  const keys = Object.keys(store.byDate).sort();
  if (keys.length <= KEEP_DAYS) return;
  const remove = keys.slice(0, Math.max(0, keys.length - KEEP_DAYS));
  for (const key of remove) delete store.byDate[key];
}

async function loadStore(): Promise<UsageStore> {
  const raw = await browser.storage.local.get(STORAGE_KEY);
  return normalizeStore((raw as Record<string, unknown>)[STORAGE_KEY]);
}

async function saveStore(store: UsageStore): Promise<void> {
  pruneOldDays(store);
  await browser.storage.local.set({ [STORAGE_KEY]: store });
}

export function usageDateKeyNow(): string {
  return toLocalDateKey(new Date());
}

export function bumpDailyUsage(event: {
  date?: string;
  task: string;
  provider?: string;
  words?: number;
  apiEvent?: boolean;
}): Promise<void> {
  return withLock(async () => {
    const dateKey = typeof event.date === 'string' && event.date.trim() ? event.date : toLocalDateKey(new Date());
    const taskKey = event.task.trim();
    if (!taskKey) return;

    const words = typeof event.words === 'number' && Number.isFinite(event.words) ? Math.max(0, event.words) : 0;
    const events = 1;
    const apiEvents = event.apiEvent ? 1 : 0;

    try {
      const store = await loadStore();
      const day =
        store.byDate[dateKey] ??
        ({
          date: dateKey,
          updatedAt: Date.now(),
          totals: emptyBucket(),
          tasks: {},
          providers: {},
        } satisfies DailyUsageSummary);

      day.updatedAt = Date.now();
      day.totals = addToBucket(day.totals, { events, apiEvents, words });
      day.tasks[taskKey] = addToBucket(day.tasks[taskKey] ?? emptyBucket(), { events, apiEvents, words });

      if (event.provider && event.provider.trim()) {
        const providerKey = event.provider.trim();
        day.providers[providerKey] = addToBucket(day.providers[providerKey] ?? emptyBucket(), { events, apiEvents, words });
      }

      store.byDate[dateKey] = day;
      await saveStore(store);
    } catch (error: unknown) {
      log.debug('Failed to bump daily usage', { message: getErrorMessage(error), event });
    }
  });
}

export async function getUsageSummary(options?: {
  days?: number;
}): Promise<{ today: DailyUsageSummary; recentDays: DailyUsageSummary[] }> {
  const requestedDays = options?.days ?? 7;
  const days = Number.isFinite(requestedDays) ? Math.max(1, Math.min(30, Math.floor(requestedDays))) : 7;

  const store = await loadStore();
  const todayKey = toLocalDateKey(new Date());
  const today =
    store.byDate[todayKey] ??
    ({
      date: todayKey,
      updatedAt: Date.now(),
      totals: emptyBucket(),
      tasks: {},
      providers: {},
    } satisfies DailyUsageSummary);

  const sortedKeys = Object.keys(store.byDate).sort().reverse();
  const recentDays = sortedKeys
    .filter((key) => typeof key === 'string' && key.trim())
    .slice(0, days)
    .map((key) => store.byDate[key])
    .filter((day): day is DailyUsageSummary => Boolean(day));

  return { today, recentDays };
}

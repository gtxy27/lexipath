import type { ProviderChannel, RouteKind } from '@lexipath/core';

export type LoggerLike = {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

const DEFAULT_CHANNEL_CONCURRENCY = 15;
const GOOGLE_TRANSLATE_CONCURRENCY = 25;
const BING_TRANSLATE_CONCURRENCY = 25;
const CONCURRENCY_SATURATION_LOG_THROTTLE_MS = 1500;
const CONCURRENCY_WAIT_TIMEOUT_MS = 60_000;

type ConcurrencyWaiter = {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  queuedAt: number;
  timeoutId: ReturnType<typeof setTimeout>;
};

type ConcurrencyState = {
  inFlight: number;
  waiters: ConcurrencyWaiter[];
};

export function createConcurrencyManager(log: LoggerLike) {
  const modelConcurrency = new Map<string, ConcurrencyState>();
  const lastSaturationLogAt = new Map<string, number>();

  function getChannelConcurrencyLimit(channel: ProviderChannel | null, kind: RouteKind): number {
    if (kind === 2) return GOOGLE_TRANSLATE_CONCURRENCY;
    if (kind === 3) return BING_TRANSLATE_CONCURRENCY;
    const raw = channel?.concurrencyLimit;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
      return Math.min(500, Math.floor(raw));
    }
    return DEFAULT_CHANNEL_CONCURRENCY;
  }

  async function acquireConcurrencySlot(key: string, limit: number): Promise<() => void> {
    const normalizedLimit = Math.max(1, Math.floor(limit));
    const state = modelConcurrency.get(key) ?? { inFlight: 0, waiters: [] };
    modelConcurrency.set(key, state);

    if (state.inFlight < normalizedLimit) {
      state.inFlight += 1;
      return () => releaseConcurrencySlot(key);
    }

    const now = Date.now();
    const lastLoggedAt = lastSaturationLogAt.get(key) ?? 0;
    if (now - lastLoggedAt >= CONCURRENCY_SATURATION_LOG_THROTTLE_MS) {
      lastSaturationLogAt.set(key, now);
      log.warn(
        `[LexiPath] Provider concurrency saturated (${key}) inFlight=${state.inFlight}/${normalizedLimit} queued=${
          state.waiters.length + 1
        }`
      );
    }

    return new Promise((resolve, reject) => {
      const queuedAt = Date.now();

      const timeoutId = setTimeout(() => {
        const idx = state.waiters.findIndex((w) => w.timeoutId === timeoutId);
        if (idx !== -1) {
          state.waiters.splice(idx, 1);
        }

        log.error(`[LexiPath] Concurrency slot acquisition timeout (${key}) after ${CONCURRENCY_WAIT_TIMEOUT_MS}ms`);
        reject(new Error(`Concurrency slot acquisition timeout for ${key}`));
      }, CONCURRENCY_WAIT_TIMEOUT_MS);

      const waiter: ConcurrencyWaiter = {
        resolve: (release) => {
          clearTimeout(timeoutId);
          const waitedMs = Date.now() - queuedAt;
          if (waitedMs >= 250) {
            log.debug(`[LexiPath] Provider concurrency wait (${key}) waitedMs=${waitedMs}`);
          }
          resolve(release);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
        queuedAt,
        timeoutId,
      };

      state.waiters.push(waiter);
    });
  }

  function releaseConcurrencySlot(key: string): void {
    const state = modelConcurrency.get(key);
    if (!state) return;

    state.inFlight = Math.max(0, state.inFlight - 1);
    const next = state.waiters.shift();
    if (next) {
      state.inFlight += 1;
      const release = () => releaseConcurrencySlot(key);
      next.resolve(release);
    }
  }

  async function runWithChannelConcurrency<T>(routeKey: string, limit: number, work: () => Promise<T>): Promise<T> {
    const release = await acquireConcurrencySlot(routeKey, limit);
    try {
      return await work();
    } finally {
      release();
    }
  }

  return { getChannelConcurrencyLimit, runWithChannelConcurrency };
}


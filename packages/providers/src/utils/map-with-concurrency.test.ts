import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapWithConcurrency } from './map-with-concurrency';

function deferred<T>() {
  let resolve: (value: T) => void;
  let reject: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return { promise, resolve: resolve!, reject: reject! };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('mapWithConcurrency', () => {
  it('returns empty array for empty input', async () => {
    await expect(mapWithConcurrency([], 3, async () => 1)).resolves.toEqual([]);
  });

  it('normalizes limit (floor + min 1) and preserves order', async () => {
    const items = [1, 2, 3, 4];

    const out = await mapWithConcurrency(items, 1.9, async (n) => String(n));

    expect(out).toEqual(['1', '2', '3', '4']);
  });

  it('runs with limited concurrency (fake timers)', async () => {
    vi.useFakeTimers();

    const items = Array.from({ length: 6 }, (_v, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;

    // Gate completions manually so the test does not depend on real time.
    const gates = items.map(() => deferred<void>());

    const promise = mapWithConcurrency(items, 3, async (n) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);

      // This timer is just a scheduling point; we still control completion via gates.
      setTimeout(() => gates[n]?.resolve(), 10);
      await gates[n]?.promise;

      inFlight -= 1;
      return n;
    });

    // Let the first wave of workers start.
    await vi.runAllTimersAsync();

    // At this point, the first batch should have been scheduled and resolved,
    // but concurrency still should never exceed 3.
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThanOrEqual(2);

    const out = await promise;
    expect(out).toEqual(items);
  });

  it('throws if an undefined item is encountered', async () => {
    const items = [1, undefined, 3] as unknown as number[];

    await expect(
      mapWithConcurrency(items, 2, async (n) => n),
    ).rejects.toThrow('mapWithConcurrency received an undefined item');
  });
});

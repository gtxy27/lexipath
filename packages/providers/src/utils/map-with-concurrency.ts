export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const normalizedLimit = Math.max(1, Math.floor(limit));
  const workerCount = Math.min(normalizedLimit, items.length);

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = new Array(workerCount).fill(null).map(async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) {
        throw new Error('mapWithConcurrency received an undefined item');
      }
      results[index] = await mapper(item, index);
    }
  });

  await Promise.all(workers);
  return results;
}

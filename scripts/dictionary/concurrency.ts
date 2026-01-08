export async function withConcurrencyLimit<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const results: T[] = new Array(tasks.length) as T[];
  let nextIndex = 0;

  const workers = new Array(Math.min(normalizedLimit, tasks.length)).fill(null).map(async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]!();
    }
  });

  await Promise.all(workers);
  return results;
}


import * as React from 'react';

export function useDebouncedSearch<T>(options: {
  query: string;
  delayMs?: number;
  search: (query: string) => Promise<T>;
  onResult: (result: T) => void;
  onStart?: () => void;
  onDone?: () => void;
}): void {
  const delayMs = options.delayMs ?? 300;

  React.useEffect(() => {
    if (!options.query.trim()) return;

    let cancelled = false;

    const timer = window.setTimeout(() => {
      void (async () => {
        options.onStart?.();
        try {
          const result = await options.search(options.query);
          if (cancelled) return;
          options.onResult(result);
        } finally {
          if (cancelled) return;
          options.onDone?.();
        }
      })();
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [options, delayMs]);
}

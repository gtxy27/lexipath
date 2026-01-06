import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from './openai-compatible';

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

describe('OpenAICompatibleProvider cancellation', () => {
  it('cancel() aborts in-flight chat request', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = options?.signal as AbortSignal | undefined;
        if (signal?.aborted) {
          reject(createAbortError());
          return;
        }
        signal?.addEventListener(
          'abort',
          () => {
            reject(createAbortError());
          },
          { once: true }
        );
      });
    });
    globalThis.fetch = fetchMock as any;

    try {
      const provider = new OpenAICompatibleProvider({
        baseUrl: 'https://example.com/v1',
        model: 'gpt-test',
        apiKey: 'test',
      });

      const promise = provider.chat([{ role: 'user', content: 'Hi' }], { maxTokens: 1, timeout: 10_000 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      provider.cancel();

      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetchMock).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('testConnection() returns TIMEOUT on cancel', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const signal = options?.signal as AbortSignal | undefined;
        if (signal?.aborted) {
          reject(createAbortError());
          return;
        }
        signal?.addEventListener(
          'abort',
          () => {
            reject(createAbortError());
          },
          { once: true }
        );
      });
    });
    globalThis.fetch = fetchMock as any;

    try {
      const provider = new OpenAICompatibleProvider({
        baseUrl: 'https://example.com/v1',
        model: 'gpt-test',
      });

      const promise = provider.testConnection();
      await new Promise((resolve) => setTimeout(resolve, 0));
      provider.cancel();

      const result = await promise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('TIMEOUT');
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});


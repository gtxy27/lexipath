import { describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from './gemini';

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

describe('GeminiProvider', () => {
  it('calls generateContent with normalized payload and returns OpenAI-like response', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
      expect(url).toContain('key=test-key');
      expect(options?.method).toBe('POST');

      const body = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>;
      expect(body.systemInstruction).toEqual({ parts: [{ text: 'System prompt' }] });
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'Hello' }] }]);
      expect((body.generationConfig as any).maxOutputTokens).toBe(5);
      expect((body.generationConfig as any).temperature).toBe(0.2);

      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: { parts: [{ text: 'OK' }] },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    globalThis.fetch = fetchMock as any;

    try {
      const provider = new GeminiProvider({
        model: 'gemini-test',
        apiKey: 'test-key',
      });

      const response = await provider.chat(
        [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'Hello' },
        ],
        { temperature: 0.2, maxTokens: 5 }
      );

      expect(response.choices[0]?.message.content).toBe('OK');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

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
      const provider = new GeminiProvider({
        model: 'gemini-test',
        apiKey: 'test-key',
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
});


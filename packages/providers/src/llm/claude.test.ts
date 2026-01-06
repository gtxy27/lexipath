import { describe, expect, it, vi } from 'vitest';
import { ClaudeProvider } from './claude';

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

describe('ClaudeProvider', () => {
  it('sends messages in Anthropic format and normalizes response', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect(options?.method).toBe('POST');

      const headers = options?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['anthropic-version']).toBeTruthy();
      expect(headers['x-api-key']).toBe('test-key');

      const body = JSON.parse(String(options?.body ?? '{}')) as Record<string, unknown>;
      expect(body.model).toBe('claude-test');
      expect(body.max_tokens).toBe(5);
      expect(body.temperature).toBe(0.2);
      expect(body.system).toBe('System prompt');
      expect(body.messages).toEqual([{ role: 'user', content: 'Hello' }]);

      return new Response(
        JSON.stringify({
          id: 'msg_1',
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'OK' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    globalThis.fetch = fetchMock as any;

    try {
      const provider = new ClaudeProvider({
        model: 'claude-test',
        apiKey: 'test-key',
        baseUrl: 'https://api.anthropic.com/v1',
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
      const provider = new ClaudeProvider({
        model: 'claude-test',
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


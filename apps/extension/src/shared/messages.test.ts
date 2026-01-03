import { describe, expect, it, vi } from 'vitest';

const runtimeSendMessage = vi.fn();

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      sendMessage: runtimeSendMessage,
    },
  },
}));

describe('sendMessage payload validation', () => {
  it('rejects invalid payload without calling runtime', async () => {
    runtimeSendMessage.mockReset();

    const { sendMessage } = await import('./messages');
    const response = await sendMessage('EXPLAIN_WORD', { word: '' } as any);

    expect(runtimeSendMessage).not.toHaveBeenCalled();
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('INVALID_PAYLOAD');
    }
  });

  it('accepts valid payload and parses response', async () => {
    runtimeSendMessage.mockReset();
    runtimeSendMessage.mockResolvedValue({ ok: true, value: { word: 'test', definition: 'ok' } });

    const { sendMessage } = await import('./messages');
    const response = await sendMessage('EXPLAIN_WORD', { word: 'test' });

    expect(runtimeSendMessage).toHaveBeenCalledWith({ type: 'EXPLAIN_WORD', payload: { word: 'test' } });
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.value.word).toBe('test');
      expect(response.value.definition).toBe('ok');
    }
  });
});

describe('createMessageHandlerRegistry payload validation', () => {
  it('returns INVALID_PAYLOAD for invalid inbound payload', async () => {
    const { createMessageHandlerRegistry } = await import('./messages');
    const registry = createMessageHandlerRegistry();
    const handler = vi.fn(async () => null);
    registry.register('EXPLAIN_WORD', handler as any);

    const response = await registry.handleIncomingMessage(
      { type: 'EXPLAIN_WORD', payload: { word: '' } },
      {} as any
    );

    expect(handler).not.toHaveBeenCalled();
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('INVALID_PAYLOAD');
    }
  });
});

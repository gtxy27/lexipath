import { describe, expect, it, vi } from 'vitest';

describe('http stream feature (scaffold)', () => {
  it('returns DISABLED and does not throw', async () => {
    const { registerHttpStreamFeature } = await import('./http-stream');
    const handler = vi.fn();
    const registry = {
      register: vi.fn((type: string, fn: any) => {
        if (type === 'OPEN_HTTP_STREAM') handler.mockImplementation(fn);
      }),
    } as any;

    registerHttpStreamFeature({ registry });

    const result = await handler({ streamId: 's1' });
    expect(result).toEqual({
      streamId: 's1',
      status: 'DISABLED',
      error: {
        code: 'HTTP_STREAM_DISABLED',
        message: 'HTTP stream transport is disabled',
      },
    });
  });
});

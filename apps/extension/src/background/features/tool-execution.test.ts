import { describe, expect, it, vi } from 'vitest';

const getSettingsMock = vi.fn(async () => ({ toolExecutionEnabled: false }));

vi.mock('../../shared/storage', () => ({
  getSettings: getSettingsMock,
}));

describe('tool execution feature (scaffold)', () => {
  it('returns REJECTED when disabled-by-default', async () => {
    const { registerToolExecutionFeature } = await import('./tool-execution');
    const handler = vi.fn();
    const registry = {
      register: vi.fn((type: string, fn: any) => {
        if (type === 'REQUEST_TOOL_EXECUTION') handler.mockImplementation(fn);
      }),
    } as any;

    registerToolExecutionFeature({ registry });

    const result = await handler({ requestId: 'r1', toolId: 'http_fetch' });
    expect(result).toEqual({
      requestId: 'r1',
      status: 'REJECTED',
      error: {
        code: 'TOOL_EXECUTION_DISABLED',
        message: 'Tool execution is disabled by default',
      },
    });
  });
});

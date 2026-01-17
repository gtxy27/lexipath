import type { createMessageHandlerRegistry } from '../../shared/messages';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;

export function registerHttpStreamFeature(options: { registry: Registry }) {
  const { registry } = options;

  registry.register('OPEN_HTTP_STREAM', async (payload) => {
    // Spec: optional capability. This scaffold keeps behavior unchanged.
    return {
      streamId: payload.streamId,
      status: 'DISABLED',
      error: {
        code: 'HTTP_STREAM_DISABLED',
        message: 'HTTP stream transport is disabled',
      },
    };
  });

  registry.register('CLOSE_HTTP_STREAM', async () => {
    // Close is a no-op until we open streams.
    return { ok: true };
  });
}

import { MessageError, type createMessageHandlerRegistry } from '../../shared/messages';

import { getSettings } from '../../shared/storage';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;

export function registerToolExecutionFeature(options: { registry: Registry }) {
  const { registry } = options;

  registry.register('REQUEST_TOOL_EXECUTION', async (payload) => {
    const settings = await getSettings();
    if (!settings.toolExecutionEnabled) {
      // Spec: disabled-by-default.
      return {
        requestId: payload.requestId,
        status: 'REJECTED',
        error: {
          code: 'TOOL_EXECUTION_DISABLED',
          message: 'Tool execution is disabled by default',
        },
      };
    }

    // Spec: network-reaching tools require explicit user confirmation.
    // This scaffold never performs execution and always returns an approval-needed status.
    return {
      requestId: payload.requestId,
      status: 'APPROVAL_REQUIRED',
      error: {
        code: 'TOOL_APPROVAL_REQUIRED',
        message: 'Tool execution requires explicit user approval',
      },
    };
  });

  registry.register('RESPOND_TOOL_APPROVAL', async () => {
    // Nothing to do until real execution exists.
    return { ok: true };
  });
}

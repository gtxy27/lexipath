import type { createMessageHandlerRegistry } from '../../shared/messages';
import { getSettings, setSettings } from '../../shared/storage';
import { bumpDailyUsage, getUsageSummary } from '../usage-summary';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;

export function registerSettingsFeature(options: { registry: Registry }) {
  const { registry } = options;

  registry.register('GET_SETTINGS', async () => {
    return getSettings();
  });

  registry.register('SET_SETTINGS', async (payload) => {
    await setSettings(payload);
    return null;
  });

  registry.register('GET_USAGE_SUMMARY', async () => {
    return getUsageSummary({ days: 7 });
  });

  registry.register('REPORT_USAGE_EVENT', async (payload) => {
    if (payload.event === 'word_card_opened') {
      void bumpDailyUsage({ task: 'word_card_opened', words: 1, apiEvent: false });
      return null;
    }
    return null;
  });
}


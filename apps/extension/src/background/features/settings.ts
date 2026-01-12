import type { createMessageHandlerRegistry } from '../../shared/messages';
import { getSettings, setSettings } from '../../shared/storage';
import { resolveChannel, resolveChannelRoute, resolveRoute } from '../lib/routing';
import { bumpDailyUsage, getUsageSummary } from '../usage-summary';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;

export function registerSettingsFeature(options: { registry: Registry }) {
  const { registry } = options;

  function isChannelConfigured(channel: { typeId: number; model?: string; config: unknown }): boolean {
    if (!channel.model?.trim()) return false;
    const cfg = channel.config as Record<string, unknown>;
    if (channel.typeId === 1) {
      return typeof cfg.baseUrl === 'string' && cfg.baseUrl.trim().length > 0;
    }
    if (channel.typeId === 2 || channel.typeId === 3) {
      return typeof cfg.apiKey === 'string' && cfg.apiKey.trim().length > 0;
    }
    return false;
  }

  registry.register('GET_SETTINGS', async () => {
    return getSettings();
  });

  registry.register('GET_WEB_PROCESSING_STATUS', async () => {
    const settings = await getSettings();

    const keywordRoute = resolveChannelRoute('select_keywords', settings);
    const translateRoute = resolveRoute('translate', settings);
    const effectiveRoute = translateRoute.kind === 1 ? translateRoute : keywordRoute;

    const keywordProviderConfigured = (() => {
      const channel = resolveChannel(keywordRoute.channelId, settings);
      if (!channel) return false;
      return isChannelConfigured(channel);
    })();

    const translationProviderConfigured = (() => {
      if (translateRoute.kind === 2 || translateRoute.kind === 3) return true;
      const channel = resolveChannel(translateRoute.channelId, settings);
      if (!channel) return false;
      return isChannelConfigured(channel);
    })();

    const webEnhanceConcurrencyLimit = (() => {
      const channel = resolveChannel(effectiveRoute.channelId, settings);
      const raw = channel?.concurrencyLimit;
      if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
        return Math.min(500, Math.floor(raw));
      }
      return 15;
    })();

    return { keywordProviderConfigured, translationProviderConfigured, webEnhanceConcurrencyLimit };
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


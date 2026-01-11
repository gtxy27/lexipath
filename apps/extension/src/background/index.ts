import browser from 'webextension-polyfill';

import { createLogger } from '@lexipath/core/log';

import { createMessageHandlerRegistry } from '../shared/messages';

import { createConcurrencyManager } from './lib/concurrency';
import { createTranslator } from './lib/i18n';

import { registerChatFeature } from './features/chat';
import { setupLifecycleListeners } from './features/lifecycle';
import { registerLearningFeature } from './features/learning';
import { registerProviderFeature } from './features/providers';
import { registerSettingsFeature } from './features/settings';
import { registerSidebarFeature } from './features/sidebar';
import { registerStorageFeature } from './features/storage';
import { maybeHandleCaptionRequestInfoMessage, setupYouTubeTimedtextInterception } from './features/youtube-captions';

const registry = createMessageHandlerRegistry();
const log = createLogger('background');
const t = createTranslator(log);
const concurrency = createConcurrencyManager(log);

setupLifecycleListeners(log);

registerSettingsFeature({ registry });
registerStorageFeature({ registry });
registerProviderFeature({ registry, t });
registerLearningFeature({ registry, t, log, concurrency });
registerChatFeature({ registry, t, log, concurrency });
registerSidebarFeature({ registry, t });

browser.runtime.onMessage.addListener((message, sender) => {
  const captionResponse = maybeHandleCaptionRequestInfoMessage(message);
  if (captionResponse) return captionResponse;
  return registry.handleIncomingMessage(message, sender);
});

setupYouTubeTimedtextInterception(log);

log.info('Background service worker started');


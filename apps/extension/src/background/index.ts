import browser from 'webextension-polyfill';

import { createLogger } from '@lexipath/core/log';

import { createMessageHandlerRegistry } from '../shared/messages';

import { createConcurrencyManager } from './lib/concurrency';
import { createTranslator } from './lib/i18n';

import { registerChatFeature } from './features/chat';
import { setupLifecycleListeners } from './features/lifecycle';
import { seedDictionaryFromPublicData } from './dictionary-seed';
import { registerLearningFeature } from './features/learning';
import { registerProviderFeature } from './features/providers';
import { registerSettingsFeature } from './features/settings';
import { registerSidebarFeature } from './features/sidebar';
import { registerStorageFeature } from './features/storage';
import { registerToolExecutionFeature } from './features/tool-execution';
import { registerHttpStreamFeature } from './features/http-stream';
import { registerSubtitlesFeature } from './features/subtitles';
import { registerYouTubeCaptionsFeature, setupYouTubeTimedtextInterception } from './features/youtube-captions';

const registry = createMessageHandlerRegistry();
const log = createLogger('background');
const t = createTranslator(log);
const concurrency = createConcurrencyManager(log);

setupLifecycleListeners(log);

// Offline dictionary seed: best-effort, idempotent, never blocks startup.
void seedDictionaryFromPublicData().catch((error: unknown) => {
  log.warn('Dictionary seed failed; continuing', { error });
});

registerSettingsFeature({ registry });
registerStorageFeature({ registry });
registerProviderFeature({ registry, t });
registerLearningFeature({ registry, t, log, concurrency });
registerChatFeature({ registry, t, log, concurrency });
registerSidebarFeature({ registry, t });
registerYouTubeCaptionsFeature({ registry });
registerSubtitlesFeature({ registry });


// Reserved scaffolding for future capabilities.
registerToolExecutionFeature({ registry });
registerHttpStreamFeature({ registry });

browser.runtime.onMessage.addListener((message, sender) => {
  return registry.handleIncomingMessage(message, sender);
});

setupYouTubeTimedtextInterception(log);

log.info('Background service worker started');


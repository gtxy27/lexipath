import browser from 'webextension-polyfill';

import { getErrorMessage } from '@lexipath/core/log';

import type { createMessageHandlerRegistry } from '../../shared/messages';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;


type LoggerLike = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  debug: (message: string, meta?: Record<string, unknown>) => void;
};

type CaptionRequestCacheEntry = { params: string; timestamp: number };

const YOUTUBE_CAPTION_PARAMS_TTL_MS = 10 * 60 * 1000;
const youtubeCaptionRequestParams = new Map<string, CaptionRequestCacheEntry>();

function extractYouTubeTimedtextAdditionalParams(url: URL): string {
  const entries = Array.from(url.searchParams.entries());
  const potcIndex = entries.findIndex(([key]) => key === 'potc');
  if (potcIndex < 0) return '';
  return entries
    .slice(potcIndex)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

function getCachedYouTubeCaptionParams(videoId: string): string {
  const entry = youtubeCaptionRequestParams.get(videoId);
  if (!entry) return '';
  if (Date.now() - entry.timestamp > YOUTUBE_CAPTION_PARAMS_TTL_MS) {
    youtubeCaptionRequestParams.delete(videoId);
    return '';
  }
  return entry.params;
}

export function registerYouTubeCaptionsFeature(options: { registry: Registry }) {
  const { registry } = options;

  registry.register('GET_CAPTION_REQUEST_INFO', async (payload) => {
    const params = payload.videoId ? getCachedYouTubeCaptionParams(payload.videoId) : '';
    return { params };
  });
}


export function setupYouTubeTimedtextInterception(log: LoggerLike) {
  if (!browser.webRequest?.onBeforeRequest?.addListener) {
    log.warn('webRequest.onBeforeRequest is unavailable; YouTube subtitle interception disabled');
    return;
  }

  // Keep background startup resilient: a failing webRequest registration can break
  // runtime messaging, which would make Options/Sidebar hang on load.
  try {
    log.info('webRequest available; enabling YouTube timedtext interception');

    browser.webRequest.onBeforeRequest.addListener(
      (details) => {
        try {
          const url = new URL(details.url);
          if (!url.hostname.endsWith('youtube.com')) return;
          if (url.pathname !== '/api/timedtext') return;

          const videoId = url.searchParams.get('v');
          if (!videoId) return;

          const additionalParams = extractYouTubeTimedtextAdditionalParams(url);
          if (!additionalParams) {
            log.debug(`Intercepted YouTube timedtext without potc (videoId=${videoId})`);
            return;
          }

          const existing = youtubeCaptionRequestParams.get(videoId);
          if (existing?.params?.includes('potc=')) {
            youtubeCaptionRequestParams.set(videoId, { params: existing.params, timestamp: Date.now() });
            return;
          }

          youtubeCaptionRequestParams.set(videoId, { params: additionalParams, timestamp: Date.now() });
          log.info(`Captured YouTube timedtext params for ${videoId}`);

          const tabId = typeof details.tabId === 'number' ? details.tabId : -1;
          if (tabId >= 0 && browser.tabs?.sendMessage) {
            void browser.tabs
              .sendMessage(tabId, {
                type: 'CAPTION_REQUEST_INTERCEPTED',
                data: { videoId, additionalParams },
              })
              .catch((error: unknown) => {
                log.debug('Failed to notify tab about caption intercept; ignoring', {
                  tabId,
                  videoId,
                  message: getErrorMessage(error),
                });
              });
          }
        } catch (error: unknown) {
          log.warn('Failed to process webRequest timedtext interception event; ignoring', {
            message: getErrorMessage(error),
          });
        }
      },
      {
        urls: ['*://www.youtube.com/api/timedtext*', '*://youtube.com/api/timedtext*', '*://*.youtube.com/api/timedtext*'],
      }
    );
  } catch (error: unknown) {
    log.warn('Failed to register YouTube timedtext interception; disabling feature', {
      message: getErrorMessage(error),
    });
  }
}


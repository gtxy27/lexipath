import { createLogger, getErrorMessage } from '@lexipath/core/log';
import type { Cue } from '@lexipath/core';
import {
  fetchBilibiliSubtitles,
  fetchYouTubeSubtitles,
  getBilibiliAvailableTracks,
  getCid,
  getVideoId as getYouTubeVideoId,
  parseVideoInfo,
  SubtitleHttpError,
} from '@lexipath/subtitles';

import { getI18nMessage } from '../../shared/i18n';
import type { createMessageHandlerRegistry } from '../../shared/messages';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;

const log = createLogger('background:subtitles');

function isBilibiliAuthLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message || '';
  // Common unauthenticated / VIP gating codes and phrases.
  return msg.includes('code -101') || msg.includes('code -10403') || msg.toLowerCase().includes('login');
}

type FetchSubtitlesPayload = {
  platform: 'youtube' | 'bilibili';
  url: string;
  targetLanguage: string;
  additionalParams?: string | undefined;
  live?: boolean | undefined;
};

type FetchSubtitlesResult = { cues: Cue[]; lang?: string; statusMessage?: string };

async function fetchYouTube(payload: FetchSubtitlesPayload): Promise<FetchSubtitlesResult> {
  const videoId = getYouTubeVideoId(payload.url);
  if (!videoId) {
    throw new Error(`Invalid YouTube URL: ${payload.url}`);
  }

  try {
    const options = {
      ...(typeof payload.additionalParams === 'string' ? { additionalParams: payload.additionalParams } : {}),
      ...(payload.live ? { live: true } : {}),
    } satisfies { additionalParams?: string; live?: boolean };
    const cues = await fetchYouTubeSubtitles(videoId, payload.targetLanguage, options);
    return { cues, lang: cues[0]?.lang ?? payload.targetLanguage };
  } catch (error) {
    if (error instanceof SubtitleHttpError && (error.status === 401 || error.status === 403)) {
      return {
        cues: [],
        lang: payload.targetLanguage,
        statusMessage: getI18nMessage('subtitle_requiresPremium'),
      };
    }
    throw error;
  }
}

async function fetchBilibili(payload: FetchSubtitlesPayload): Promise<FetchSubtitlesResult> {
  const info = parseVideoInfo(payload.url);
  if (!info) {
    throw new Error(`Invalid Bilibili URL: ${payload.url}`);
  }

  try {
    const cid = info.cid ?? (await getCid(info.bvid, info.pageNumber));
    const tracks = await getBilibiliAvailableTracks(info.bvid, cid);

    if (tracks.length === 0) {
      log.info('No subtitle tracks found');
      return { cues: [] };
    }

    const desired = payload.targetLanguage.toLowerCase();
    const preferred =
      tracks.find((track) => track.languageCode.toLowerCase() === desired) ??
      tracks.find((track) => track.languageCode.toLowerCase().startsWith(`${desired}-`)) ??
      tracks.find((track) => track.languageCode.toLowerCase().includes(desired));
    const track = preferred || tracks[0];
    if (!track) return { cues: [] };

    const cues = await fetchBilibiliSubtitles(track.url);
    return { cues, lang: track.languageCode };
  } catch (error) {
    if (error instanceof SubtitleHttpError && (error.status === 401 || error.status === 403)) {
      return { cues: [], statusMessage: getI18nMessage('subtitle_requiresVip') };
    }
    if (isBilibiliAuthLikeError(error)) {
      return { cues: [], statusMessage: getI18nMessage('subtitle_requiresVip') };
    }
    throw error;
  }
}

export function registerSubtitlesFeature(options: { registry: Registry }) {
  const { registry } = options;

  registry.register('FETCH_SUBTITLES', async (payload: FetchSubtitlesPayload) => {
    try {
      if (payload.platform === 'youtube') return fetchYouTube(payload);
      return fetchBilibili(payload);
    } catch (error: unknown) {
      log.warn('FETCH_SUBTITLES failed', { message: getErrorMessage(error), platform: payload.platform });
      throw error;
    }
  });
}

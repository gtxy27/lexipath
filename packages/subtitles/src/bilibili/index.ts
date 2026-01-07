/**
 * Bilibili subtitle adapter.
 * Fetches and normalizes Bilibili subtitles to Cue format.
 */

import type { Cue } from '@lexipath/core';
import { z } from 'zod';
import { SubtitleHttpError } from '../http-error';

export interface BilibiliSubtitleTrack {
  languageCode: string;
  name: string;
  url: string;
}

export function parseVideoInfo(
  url: string
): { bvid: string; cid?: string; pageNumber?: number } | null {
  const raw = url.trim();
  if (!raw) return null;

  let bvid: string | null = null;
  let cid: string | undefined;
  let pageNumber: number | undefined;

  try {
    const parsedUrl = new URL(raw);

    const bvidParam = parsedUrl.searchParams.get('bvid');
    if (bvidParam) {
      const match = bvidParam.match(/(BV[0-9A-Za-z]{10})/i);
      const candidate = match?.[1];
      if (candidate) bvid = candidate;
    }

    const cidParam = parsedUrl.searchParams.get('cid');
    if (cidParam && /^\d+$/.test(cidParam)) {
      cid = cidParam;
    }

    const pageParam = parsedUrl.searchParams.get('p');
    if (pageParam && /^\d+$/.test(pageParam)) {
      const parsedPage = Number.parseInt(pageParam, 10);
      if (Number.isFinite(parsedPage) && parsedPage >= 1) {
        pageNumber = parsedPage;
      }
    }

    if (!bvid) {
      const match = parsedUrl.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/i);
      const candidate = match?.[1];
      if (candidate) bvid = candidate;
    }
  } catch (error: unknown) {
    // Not a valid absolute URL; fall back to regex parsing.
  }

  if (!bvid) {
    const match = raw.match(/\b(BV[0-9A-Za-z]{10})\b/i);
    const candidate = match?.[1];
    if (candidate) bvid = candidate;
  }

  if (!cid) {
    const match = raw.match(/[?&]cid=(\d+)/);
    if (match) cid = match[1];
  }

  if (!bvid) return null;
  return { bvid, ...(cid ? { cid } : {}), ...(pageNumber ? { pageNumber } : {}) };
}

const BilibiliViewApiResponseSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z
    .object({
      cid: z.union([z.string(), z.number()]).optional(),
      pages: z
        .array(
          z.object({
            cid: z.union([z.string(), z.number()]),
          })
        )
        .optional(),
    })
    .optional(),
});

/**
 * Get the cid for a given bvid using Bilibili's view API.
 */
export async function getCid(bvid: string, pageNumber?: number): Promise<string> {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Bilibili view API failed: HTTP ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as unknown;
  const parsed = BilibiliViewApiResponseSchema.parse(json);

  if (parsed.code !== 0) {
    throw new Error(`Bilibili view API error: code ${parsed.code}${parsed.message ? ` - ${parsed.message}` : ''}`);
  }

  const pages = parsed.data?.pages ?? [];
  const pageIndex = typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber >= 1 ? pageNumber - 1 : -1;
  const cidCandidate = pages[pageIndex]?.cid ?? pages[0]?.cid ?? parsed.data?.cid;
  if (cidCandidate === undefined || cidCandidate === null || cidCandidate === '') {
    throw new Error(`Bilibili view API did not return cid for bvid: ${bvid}`);
  }

  return String(cidCandidate);
}

const BilibiliPlayerApiResponseSchema = z.object({
  code: z.number(),
  message: z.string().optional(),
  data: z
    .object({
      subtitle: z
        .object({
          subtitles: z
            .array(
              z.object({
                id: z.union([z.string(), z.number()]).optional(),
                lan: z.string().optional(),
                lan_doc: z.string().optional(),
                subtitle_url: z.string().optional(),
                subtitle_url_v2: z.string().optional(),
              })
            )
            .optional(),
          list: z
            .array(
              z.object({
                id: z.union([z.string(), z.number()]).optional(),
                lan: z.string().optional(),
                lan_doc: z.string().optional(),
                subtitle_url: z.string().optional(),
                subtitle_url_v2: z.string().optional(),
              })
            )
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

function normalizeSubtitleUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}

/**
 * Get available subtitle tracks for the given bvid + cid.
 */
export async function getAvailableTracks(
  bvid: string,
  cid: string
): Promise<BilibiliSubtitleTrack[]> {
  const url = `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Bilibili player API failed: HTTP ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as unknown;
  const parsed = BilibiliPlayerApiResponseSchema.parse(json);

  if (parsed.code !== 0) {
    throw new Error(
      `Bilibili player API error: code ${parsed.code}${parsed.message ? ` - ${parsed.message}` : ''}`
    );
  }

  const subtitles = parsed.data?.subtitle?.subtitles ?? parsed.data?.subtitle?.list ?? [];

  return subtitles
    .map((track): BilibiliSubtitleTrack | null => {
      const rawUrl = track.subtitle_url || track.subtitle_url_v2;
      if (!rawUrl) return null;

      const languageCode = track.lan ?? '';
      const name = track.lan_doc ?? languageCode;
      const normalizedUrl = normalizeSubtitleUrl(rawUrl);

      return {
        languageCode,
        name,
        url: normalizedUrl,
      };
    })
    .filter((track): track is BilibiliSubtitleTrack => track !== null);
}

const BilibiliSubtitleFileSchema = z.object({
  body: z
    .array(
      z.object({
        from: z.coerce.number(),
        to: z.coerce.number(),
        content: z.coerce.string(),
      })
    )
    .optional(),
});

function decodeHtmlEntities(input: string): string {
  const withBreaks = input.replace(/<br\s*\/?>/gi, '\n');

  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00A0',
  };

  return withBreaks.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x';
      const numeric = isHex ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(numeric, isHex ? 16 : 10);
        if (Number.isFinite(codePoint) && codePoint >= 0) {
          try {
            return String.fromCodePoint(codePoint);
          } catch (error: unknown) {
            return match;
          }
        }
      return match;
    }

    return named[entity] ?? match;
  });
}

export function bilibiliSubtitleJsonToCues(
  subtitleJson: unknown,
  options: { lang?: string } = {}
): Cue[] {
  const parsed = BilibiliSubtitleFileSchema.parse(subtitleJson);
  const lang = options.lang ?? 'und';
  const body = parsed.body ?? [];

  return body
    .map((line, index): Cue | null => {
      const startMs = Math.round(line.from * 1000);
      const endMs = Math.round(line.to * 1000);
      const text = decodeHtmlEntities(line.content).trim();

      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
      if (endMs <= startMs) return null;
      if (!text) return null;

      return {
        id: `bilibili:${startMs}-${endMs}:${index}`,
        startMs,
        endMs,
        text,
        lang,
        source: 'bilibili',
      };
    })
    .filter((cue): cue is Cue => cue !== null);
}

/**
 * Fetch subtitles from a Bilibili subtitle URL (JSON) and normalize to Cue[] format.
 */
export async function fetchSubtitles(subtitleUrl: string): Promise<Cue[]> {
  const url = normalizeSubtitleUrl(subtitleUrl);
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });

  if (!response.ok) {
    throw new SubtitleHttpError('Bilibili subtitle fetch failed', {
      status: response.status,
      statusText: response.statusText,
      url,
    });
  }

  const json = (await response.json()) as unknown;
  return bilibiliSubtitleJsonToCues(json);
}

export class BilibiliAdapter {
  /**
   * Get available subtitle tracks for a video.
   */
  async getAvailableTracks(bvid: string, cid: string): Promise<BilibiliSubtitleTrack[]> {
    return getAvailableTracks(bvid, cid);
  }

  /**
   * Fetch subtitles from a track URL.
   */
  async fetchSubtitles(url: string): Promise<Cue[]> {
    return fetchSubtitles(url);
  }
}

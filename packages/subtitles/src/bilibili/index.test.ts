import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bilibiliSubtitleJsonToCues,
  fetchSubtitles,
  getAvailableTracks,
  getCid,
  parseVideoInfo,
} from './index';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('parseVideoInfo', () => {
  it('parses bvid from a standard video URL', () => {
    expect(parseVideoInfo('https://www.bilibili.com/video/BV1Q5411W7x1/?p=1')).toEqual({
      bvid: 'BV1Q5411W7x1',
    });
  });

  it('parses bvid + cid from an API URL', () => {
    expect(
      parseVideoInfo('https://api.bilibili.com/x/player/v2?bvid=BV1Q5411W7x1&cid=123456')
    ).toEqual({
      bvid: 'BV1Q5411W7x1',
      cid: '123456',
    });
  });

  it('returns null when url does not contain a bvid', () => {
    expect(parseVideoInfo('https://www.example.com/watch?v=123')).toBeNull();
  });
});

describe('getCid', () => {
  it('fetches cid from view API pages[0].cid', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            pages: [{ cid: 987654 }],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(getCid('BV1Q5411W7x1')).resolves.toBe('987654');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('x/web-interface/view?bvid=BV1Q5411W7x1');
  });

  it('falls back to data.cid when pages are missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              cid: '222',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      })
    );

    await expect(getCid('BV1Q5411W7x1')).resolves.toBe('222');
  });
});

describe('getAvailableTracks', () => {
  it('maps subtitle tracks and normalizes // urls to https', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              subtitle: {
                subtitles: [
                  {
                    id: 1,
                    lan: 'en',
                    lan_doc: 'English',
                    subtitle_url: '//i0.hdslb.com/bfs/subtitle/a.json',
                  },
                  {
                    id: 2,
                    lan: 'zh-Hans',
                    lan_doc: '简体中文',
                    subtitle_url_v2: 'https://i0.hdslb.com/bfs/subtitle/b.json',
                  },
                  {
                    id: 3,
                    lan: 'ja',
                    lan_doc: '日本語',
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      })
    );

    const tracks = await getAvailableTracks('BV1Q5411W7x1', '987654');

    expect(tracks).toEqual([
      {
        languageCode: 'en',
        name: 'English',
        url: 'https://i0.hdslb.com/bfs/subtitle/a.json',
      },
      {
        languageCode: 'zh-Hans',
        name: '简体中文',
        url: 'https://i0.hdslb.com/bfs/subtitle/b.json',
      },
    ]);
  });
});

describe('bilibiliSubtitleJsonToCues', () => {
  it('converts subtitle JSON body items to Cue[]', () => {
    const cues = bilibiliSubtitleJsonToCues({
      body: [
        { from: 0.5, to: 1.75, content: 'Hello &amp; world' },
        { from: 2, to: 2, content: 'invalid (zero duration)' },
        { from: '3.0', to: '4.1', content: '<br>Line 2' },
      ],
    });

    expect(cues).toEqual([
      {
        id: 'bilibili:500-1750:0',
        startMs: 500,
        endMs: 1750,
        text: 'Hello & world',
        lang: 'und',
        source: 'bilibili',
      },
      {
        id: 'bilibili:3000-4100:2',
        startMs: 3000,
        endMs: 4100,
        text: 'Line 2',
        lang: 'und',
        source: 'bilibili',
      },
    ]);
  });

  it('allows passing lang to attach to cues', () => {
    const cues = bilibiliSubtitleJsonToCues(
      { body: [{ from: 0, to: 1, content: 'Test' }] },
      { lang: 'en' }
    );

    expect(cues[0]?.lang).toBe('en');
  });
});

describe('fetchSubtitles', () => {
  it('fetches subtitle JSON and returns cues', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          body: [{ from: 0, to: 1.2, content: 'Hi' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const cues = await fetchSubtitles('//i0.hdslb.com/bfs/subtitle/test.json');

    expect(cues).toEqual([
      {
        id: 'bilibili:0-1200:0',
        startMs: 0,
        endMs: 1200,
        text: 'Hi',
        lang: 'und',
        source: 'bilibili',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://i0.hdslb.com/bfs/subtitle/test.json');
  });
});

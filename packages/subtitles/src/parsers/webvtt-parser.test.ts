import { describe, expect, it } from 'vitest';
import { parseWebVtt } from './webvtt-parser';

describe('parseWebVtt', () => {
  it('parses basic cues and strips tags', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:03.000
Hello <b>world</b>

00:00:04.000 --> 00:00:05.500
<v Speaker>Hi</v>
`;

    const cues = parseWebVtt(vtt);
    expect(cues).toEqual([
      {
        id: 'webvtt:1000-3000:0',
        startMs: 1000,
        endMs: 3000,
        text: 'Hello world',
        lang: 'und',
        source: 'generic',
      },
      {
        id: 'webvtt:4000-5500:1',
        startMs: 4000,
        endMs: 5500,
        text: 'Hi',
        lang: 'und',
        source: 'generic',
      },
    ]);
  });

  it('supports mm:ss.mmm timestamps', () => {
    const vtt = `WEBVTT

00:01.000 --> 00:02.000
Test
`;

    const cues = parseWebVtt(vtt, { lang: 'en' });
    expect(cues[0]?.startMs).toBe(1000);
    expect(cues[0]?.endMs).toBe(2000);
    expect(cues[0]?.lang).toBe('en');
  });
});


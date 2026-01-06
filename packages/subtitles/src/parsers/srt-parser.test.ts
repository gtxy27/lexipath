import { describe, expect, it } from 'vitest';
import { parseSrt } from './srt-parser';

describe('parseSrt', () => {
  it('parses blocks and supports comma/dot milliseconds', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
Hello

2
00:00:03.500 --> 00:00:04.000
Hi
`;

    const cues = parseSrt(srt, { lang: 'en' });
    expect(cues).toEqual([
      {
        id: 'srt:1000-2000:0',
        startMs: 1000,
        endMs: 2000,
        text: 'Hello',
        lang: 'en',
        source: 'generic',
      },
      {
        id: 'srt:3500-4000:1',
        startMs: 3500,
        endMs: 4000,
        text: 'Hi',
        lang: 'en',
        source: 'generic',
      },
    ]);
  });
});


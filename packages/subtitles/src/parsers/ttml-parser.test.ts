import { describe, expect, it } from 'vitest';
import { parseTtml } from './ttml-parser';

describe('parseTtml', () => {
  it('parses begin/end and preserves <br/> as line breaks', () => {
    const ttml = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:00:01.000" end="00:00:02.000">Hello<br/>world</p>
    </div>
  </body>
</tt>`;

    const cues = parseTtml(ttml, { lang: 'en', source: 'netflix' });
    expect(cues).toEqual([
      {
        id: 'ttml:1000-2000:0',
        startMs: 1000,
        endMs: 2000,
        text: 'Hello\nworld',
        lang: 'en',
        source: 'netflix',
      },
    ]);
  });

  it('supports begin + dur time expressions', () => {
    const ttml = `<tt><body><div>
      <p begin="1.5s" dur="500ms">Hi</p>
    </div></body></tt>`;

    const cues = parseTtml(ttml);
    expect(cues[0]?.startMs).toBe(1500);
    expect(cues[0]?.endMs).toBe(2000);
    expect(cues[0]?.text).toBe('Hi');
  });
});


import { describe, expect, it, vi } from 'vitest';
import { BingTranslateProvider } from './bing-translate';

describe('BingTranslateProvider', () => {
  it('fetches token then translates via ttranslatev3', async () => {
    const originalFetch = globalThis.fetch;

    const now = Date.now();
    const html = `
      <html>
        <head></head>
        <body>
          <script>
            var IG:"IG_TEST";
            var params_AbusePreventionHelper = ["KEY_TEST","TOKEN_TEST",${now},600000];
          </script>
          <div data-iid="Translator.1234"></div>
        </body>
      </html>
    `;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://www.bing.com/translator',
        text: async () => html,
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ translations: [{ text: '你好' }] }],
      } as any);

    globalThis.fetch = fetchMock as any;

    try {
      const provider = new BingTranslateProvider();
      const result = await provider.translate('hello', { from: 'en', to: 'zh-CN' });
      expect(result).toBe('你好');

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://www.bing.com/translator');

      const call2 = fetchMock.mock.calls[1];
      expect(String(call2?.[0])).toContain('https://www.bing.com/ttranslatev3');
      expect(String(call2?.[0])).toContain('IG=IG_TEST');
      expect(String(call2?.[0])).toContain('IID=Translator.1234.0');

      const init = call2?.[1] as RequestInit;
      const body = String(init?.body ?? '');
      expect(body).toContain('fromLang=en');
      expect(body).toContain('to=zh-Hans');
      expect(body).toContain('text=hello');
      expect(body).toContain('token=TOKEN_TEST');
      expect(body).toContain('key=KEY_TEST');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reuses cached token across calls', async () => {
    const originalFetch = globalThis.fetch;

    const now = Date.now();
    const html = `
      <html>
        <body>
          <script>
            var IG:"IG_TEST";
            var params_AbusePreventionHelper = ["KEY_TEST","TOKEN_TEST",${now},600000];
          </script>
          <div data-iid="Translator.1234"></div>
        </body>
      </html>
    `;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: 'https://www.bing.com/translator',
        text: async () => html,
      } as any)
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => [{ translations: [{ text: '你好' }] }],
      } as any);

    globalThis.fetch = fetchMock as any;

    try {
      const provider = new BingTranslateProvider();
      await provider.translate('hello', { from: 'en', to: 'zh-CN' });
      await provider.translate('hello', { from: 'en', to: 'zh-CN' });

      // First call: token + translate; second call: translate only
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://www.bing.com/translator');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});


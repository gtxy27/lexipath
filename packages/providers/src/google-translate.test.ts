import { describe, expect, it, vi } from 'vitest';
import { GoogleTranslateProvider } from './google-translate';

describe('GoogleTranslateProvider', () => {
  it('translates text via googleapis endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.hostname).toBe('translate.googleapis.com');
      expect(parsed.searchParams.get('sl')).toBe('en');
      expect(parsed.searchParams.get('tl')).toBe('zh-CN');
      expect(parsed.searchParams.get('q')).toBe('hello');

      return new Response(JSON.stringify([[['你好', 'hello', null, null, 10]]]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchMock as any;

    try {
      const provider = new GoogleTranslateProvider();
      const translated = await provider.translate('hello', { from: 'en', to: 'zh-CN' });
      expect(translated).toBe('你好');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('normalizes zh -> zh-CN', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: string) => {
      const parsed = new URL(url);
      expect(parsed.searchParams.get('sl')).toBe('zh-CN');
      expect(parsed.searchParams.get('tl')).toBe('en');

      return new Response(JSON.stringify([[['hello', '你好', null, null, 10]]]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    globalThis.fetch = fetchMock as any;

    try {
      const provider = new GoogleTranslateProvider();
      const translated = await provider.translate('你好', { from: 'zh', to: 'en' });
      expect(translated).toBe('hello');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});


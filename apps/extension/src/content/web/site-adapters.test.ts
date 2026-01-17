/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi } from 'vitest';

describe('site-adapters', () => {
  it('returns default adapter when URL is invalid', async () => {
    vi.resetModules();
    vi.doMock('./site-adapters/index', () => ({ WEB_SITE_ADAPTERS: [] }));

    const { getWebSiteAdapter } = await import('./site-adapters');
    const adapter = getWebSiteAdapter('not a url');
    expect(adapter.id).toBe('default');
  });

  it('returns default adapter when nothing matches', async () => {
    vi.resetModules();
    vi.doMock('./site-adapters/index', () => ({
      WEB_SITE_ADAPTERS: [
        {
          id: 'test-adapter',
          matches: (url: URL) => url.hostname === 'not-example.com',
          create: () => ({
            id: 'test-adapter',
            textSelector: 'p',
            shouldQueueElement: () => true,
            shouldProcessElement: () => true,
          }),
        },
      ],
    }));

    const { getWebSiteAdapter } = await import('./site-adapters');
    expect(getWebSiteAdapter('https://example.com/hello').id).toBe('default');
  });

  it('returns a matching adapter from the static list', async () => {
    vi.resetModules();
    vi.doMock('./site-adapters/index', () => ({
      WEB_SITE_ADAPTERS: [
        {
          id: 'example',
          matches: (url: URL) => url.hostname === 'example.com',
          create: () => ({
            id: 'example',
            textSelector: 'article p',
            shouldQueueElement: () => true,
            shouldProcessElement: () => true,
          }),
        },
      ],
    }));

    const { getWebSiteAdapter } = await import('./site-adapters');
    const adapter = getWebSiteAdapter('https://example.com/path');
    expect(adapter.id).toBe('example');
    expect(adapter.textSelector).toBe('article p');
  });

  it('falls back to default if an adapter throws', async () => {
    vi.resetModules();
    vi.doMock('./site-adapters/index', () => ({
      WEB_SITE_ADAPTERS: [
        {
          id: 'throwing',
          matches: () => {
            throw new Error('boom');
          },
          create: () => ({
            id: 'throwing',
            textSelector: 'p',
            shouldQueueElement: () => true,
            shouldProcessElement: () => true,
          }),
        },
      ],
    }));

    const { getWebSiteAdapter } = await import('./site-adapters');
    expect(getWebSiteAdapter('https://example.com').id).toBe('default');
  });

  it('uses the first matching adapter in list order', async () => {
    vi.resetModules();

    const firstCreate = vi.fn(() => ({
      id: 'first',
      textSelector: 'article p',
      shouldQueueElement: () => true,
      shouldProcessElement: () => true,
    }));

    const secondCreate = vi.fn(() => ({
      id: 'second',
      textSelector: 'main p',
      shouldQueueElement: () => true,
      shouldProcessElement: () => true,
    }));

    vi.doMock('./site-adapters/index', () => ({
      WEB_SITE_ADAPTERS: [
        {
          id: 'first',
          matches: (url: URL) => url.hostname === 'example.com',
          create: firstCreate,
        },
        {
          id: 'second',
          matches: (url: URL) => url.hostname === 'example.com',
          create: secondCreate,
        },
      ],
    }));

    const { getWebSiteAdapter } = await import('./site-adapters');
    const adapter = getWebSiteAdapter('https://example.com/path');

    expect(adapter.id).toBe('first');
    expect(firstCreate).toHaveBeenCalledTimes(1);
    expect(secondCreate).toHaveBeenCalledTimes(0);
  });
});

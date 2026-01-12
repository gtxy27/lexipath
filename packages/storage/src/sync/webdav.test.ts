import { describe, expect, it, vi } from 'vitest';
import type { WebDAVConfig } from '@lexipath/core';
import { WebDAVProvider } from './webdav';

function okResponse(status = 200): Response {
  return new Response(null, { status });
}

describe('WebDAVProvider', () => {
  it('testConnection falls back to OPTIONS when PROPFIND is not supported', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(405))
      .mockResolvedValueOnce(okResponse(204));
    vi.stubGlobal('fetch', fetchMock);

    const config: WebDAVConfig = {
      url: 'https://example.com/dav',
      username: 'user',
      password: 'pass',
      path: '/LexiPath/backup.json',
    };

    const provider = new WebDAVProvider(config);
    const res = await provider.testConnection();

    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.com/dav/',
      expect.objectContaining({ method: 'PROPFIND' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/dav/',
      expect.objectContaining({ method: 'OPTIONS' })
    );
  });

  it('upload ensures remote directories then PUTs to the file path', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse(405)) // MKCOL /LexiPath/
      .mockResolvedValueOnce(okResponse(201)) // MKCOL /LexiPath/backups/
      .mockResolvedValueOnce(okResponse(200)); // PUT file
    vi.stubGlobal('fetch', fetchMock);

    const config: WebDAVConfig = {
      url: 'https://example.com/dav',
      username: 'user',
      password: 'pass',
      path: '/LexiPath/backups/backup.json',
    };

    const provider = new WebDAVProvider(config);
    const res = await provider.upload({ hello: 'world' });

    expect(res).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://example.com/dav/LexiPath/',
      expect.objectContaining({ method: 'MKCOL' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://example.com/dav/LexiPath/backups/',
      expect.objectContaining({ method: 'MKCOL' })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://example.com/dav/LexiPath/backups/backup.json',
      expect.objectContaining({ method: 'PUT', headers: expect.any(Object), body: JSON.stringify({ hello: 'world' }) })
    );
  });

  it('upload returns invalid config when the path points to a directory', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const config: WebDAVConfig = {
      url: 'https://example.com/dav',
      username: 'user',
      password: 'pass',
      path: '/LexiPath/',
    };

    const provider = new WebDAVProvider(config);
    const res = await provider.upload({ any: 'data' });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('WEBDAV_INVALID_CONFIG');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('download returns null when the remote file does not exist (404)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404, statusText: 'Not Found' }));
    vi.stubGlobal('fetch', fetchMock);

    const config: WebDAVConfig = {
      url: 'https://example.com/dav',
      username: 'user',
      password: 'pass',
      path: '/LexiPath/backup.json',
    };

    const provider = new WebDAVProvider(config);
    const res = await provider.download();

    expect(res).toEqual({ ok: true, value: null });
  });

  it('download reports invalid JSON responses', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: vi.fn().mockRejectedValue(new Error('bad json')),
    });
    vi.stubGlobal('fetch', fetchMock);

    const config: WebDAVConfig = {
      url: 'https://example.com/dav',
      username: 'user',
      password: 'pass',
      path: '/LexiPath/backup.json',
    };

    const provider = new WebDAVProvider(config);
    const res = await provider.download();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('WEBDAV_INVALID_RESPONSE');
    }
  });
});


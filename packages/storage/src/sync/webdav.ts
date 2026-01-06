import { type WebDAVConfig } from '@lexipath/core';
import { createLogger, getErrorMessage } from '@lexipath/core/log';

const log = createLogger('storage:webdav');

type WebDAVErrorCode =
  | 'WEBDAV_INVALID_CONFIG'
  | 'WEBDAV_NETWORK_ERROR'
  | 'WEBDAV_AUTH_ERROR'
  | 'WEBDAV_FORBIDDEN'
  | 'WEBDAV_NOT_FOUND'
  | 'WEBDAV_SERVER_ERROR'
  | 'WEBDAV_INVALID_RESPONSE'
  | 'WEBDAV_ERROR';

type WebDAVResult =
  | { ok: true }
  | { ok: false; error: { code: WebDAVErrorCode; message: string } };

type WebDAVErrorResult = Extract<WebDAVResult, { ok: false }>;

function toBaseUrl(input: string): string {
  const url = new URL(input);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.toString();
}

function normalizeDavPath(path: string | undefined): string {
  const raw = (path ?? '/LexiPath/backup.json').trim() || '/LexiPath/backup.json';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

function encodeBase64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function errorFromResponse(response: Response): WebDAVErrorResult {
  if (response.status === 401) {
    return { ok: false, error: { code: 'WEBDAV_AUTH_ERROR', message: 'Authentication failed' } };
  }
  if (response.status === 403) {
    return { ok: false, error: { code: 'WEBDAV_FORBIDDEN', message: 'Access forbidden' } };
  }
  if (response.status === 404) {
    return { ok: false, error: { code: 'WEBDAV_NOT_FOUND', message: 'Resource not found' } };
  }
  if (response.status === 409) {
    return { ok: false, error: { code: 'WEBDAV_ERROR', message: 'Conflict creating resource' } };
  }
  if (response.status >= 500) {
    return {
      ok: false,
      error: { code: 'WEBDAV_SERVER_ERROR', message: `Server error (${response.status})` },
    };
  }
  return {
    ok: false,
    error: {
      code: 'WEBDAV_ERROR',
      message: `WebDAV error ${response.status}: ${response.statusText}`,
    },
  };
}

export class WebDAVProvider {
  constructor(private config: WebDAVConfig) {}

  private get authHeader(): string {
    return `Basic ${encodeBase64Utf8(`${this.config.username}:${this.config.password}`)}`;
  }

  private get baseUrl(): string {
    return toBaseUrl(this.config.url);
  }

  private get normalizedPath(): string {
    return normalizeDavPath(this.config.path);
  }

  private get fileUrl(): string {
    const baseUrl = this.baseUrl;
    const path = this.normalizedPath.slice(1);
    return new URL(path, baseUrl).toString();
  }

  private get directoryUrls(): string[] {
    const baseUrl = this.baseUrl;
    const dirPath = this.normalizedPath.endsWith('/')
      ? this.normalizedPath
      : this.normalizedPath.replace(/\/[^/]*$/, '/');
    const segments = dirPath.split('/').filter(Boolean);

    const urls: string[] = [];
    let current = '';
    for (const segment of segments) {
      current += `${segment}/`;
      urls.push(new URL(current, baseUrl).toString());
    }
    return urls;
  }

  private async mkcol(url: string): Promise<WebDAVResult> {
    try {
      const response = await fetch(url, {
        method: 'MKCOL',
        headers: {
          Authorization: this.authHeader,
        },
      });

      // 201 = created, 405 = already exists, some servers return 204 for no content.
      if (response.status === 201 || response.status === 204 || response.status === 405) {
        return { ok: true };
      }
      return errorFromResponse(response);
    } catch (error) {
      log.warn('MKCOL request failed', { url, message: getErrorMessage(error) });
      const message = error instanceof Error ? error.message : 'Network error';
      return { ok: false, error: { code: 'WEBDAV_NETWORK_ERROR', message } };
    }
  }

  private async ensureRemoteDirectories(): Promise<WebDAVResult> {
    for (const url of this.directoryUrls) {
      const res = await this.mkcol(url);
      if (res.ok) continue;
      return res;
    }
    return { ok: true };
  }

  async testConnection(): Promise<WebDAVResult> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: this.authHeader,
          Depth: '0',
          Accept: 'application/xml, text/xml, */*',
          'Content-Type': 'application/xml; charset=utf-8',
        },
        body: `<?xml version="1.0" encoding="utf-8" ?>
<propfind xmlns="DAV:">
  <prop>
    <currentuserprincipal />
  </prop>
</propfind>`,
      });

      if (response.status >= 200 && response.status < 300) return { ok: true };

      // Some WebDAV endpoints do not allow PROPFIND; attempt OPTIONS as fallback.
      if (response.status === 405 || response.status === 501) {
        const optionsRes = await fetch(this.baseUrl, {
          method: 'OPTIONS',
          headers: {
            Authorization: this.authHeader,
          },
        });
        if (optionsRes.status >= 200 && optionsRes.status < 300) return { ok: true };
        return errorFromResponse(optionsRes);
      }

      return errorFromResponse(response);
    } catch (error) {
      log.warn('WebDAV testConnection request failed', { baseUrl: this.baseUrl, message: getErrorMessage(error) });
      const message = error instanceof Error ? error.message : 'Network error';
      return { ok: false, error: { code: 'WEBDAV_NETWORK_ERROR', message } };
    }
  }

  async upload(data: unknown): Promise<WebDAVResult> {
    if (this.normalizedPath.endsWith('/')) {
      return {
        ok: false,
        error: { code: 'WEBDAV_INVALID_CONFIG', message: 'Backup path must point to a file' },
      };
    }

    const ensureRes = await this.ensureRemoteDirectories();
    if (!ensureRes.ok) return ensureRes;

    try {
      const response = await fetch(this.fileUrl, {
        method: 'PUT',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (response.ok) return { ok: true };
      return errorFromResponse(response);
    } catch (error) {
      log.warn('WebDAV upload request failed', { fileUrl: this.fileUrl, message: getErrorMessage(error) });
      const message = error instanceof Error ? error.message : 'Network error';
      return { ok: false, error: { code: 'WEBDAV_NETWORK_ERROR', message } };
    }
  }

  async download(): Promise<{ ok: true; value: unknown | null } | { ok: false; error: { code: WebDAVErrorCode; message: string } }> {
    try {
      const response = await fetch(this.fileUrl, {
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json, */*',
        },
      });

      if (!response.ok) {
        if (response.status === 404) return { ok: true, value: null };
        return errorFromResponse(response);
      }

      try {
        const value = await response.json();
        return { ok: true, value };
      } catch (error) {
        log.warn('WebDAV download returned invalid JSON', { fileUrl: this.fileUrl, message: getErrorMessage(error) });
        const message = error instanceof Error ? error.message : 'Invalid JSON response';
        return { ok: false, error: { code: 'WEBDAV_INVALID_RESPONSE', message } };
      }
    } catch (error) {
      log.warn('WebDAV download request failed', { fileUrl: this.fileUrl, message: getErrorMessage(error) });
      const message = error instanceof Error ? error.message : 'Network error';
      return { ok: false, error: { code: 'WEBDAV_NETWORK_ERROR', message } };
    }
  }
}

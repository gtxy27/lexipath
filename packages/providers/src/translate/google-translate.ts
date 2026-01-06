import { classifyError, type ProviderError } from './errors';

const DEFAULT_TIMEOUT_MS = 15000;

function normalizeGoogleLanguageCode(code: string): string {
  if (!code) return code;
  if (code === 'zh') return 'zh-CN';
  return code;
}

function parseGoogleTranslateResponse(raw: unknown): string {
  if (!Array.isArray(raw)) throw new Error('Invalid Google Translate response (expected array)');
  const first = raw[0];
  if (!Array.isArray(first)) throw new Error('Invalid Google Translate response (missing translations array)');

  const parts: string[] = [];
  for (const item of first) {
    if (!Array.isArray(item)) continue;
    const translated = item[0];
    if (typeof translated === 'string') {
      parts.push(translated);
    }
  }

  return parts.join('');
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export class GoogleTranslateProvider {
  private apiUrl: string;

  constructor(options: { apiUrl?: string } = {}) {
    this.apiUrl = options.apiUrl ?? 'https://translate.googleapis.com/translate_a/single';
  }

  async translate(text: string, options: { from: string; to: string; timeout?: number }): Promise<string> {
    const from = normalizeGoogleLanguageCode(options.from);
    const to = normalizeGoogleLanguageCode(options.to);
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;

    const url = new URL(this.apiUrl);
    url.searchParams.set('client', 'gtx');
    url.searchParams.set('dt', 't');
    url.searchParams.set('sl', from);
    url.searchParams.set('tl', to);
    url.searchParams.set('q', text);

    const response = await fetchWithTimeout(url.toString(), { method: 'GET' }, timeoutMs);
    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Provider error: ${response.status} - ${errorText}`);
      (error as any).status = response.status;
      (error as any).body = errorText;
      throw error;
    }

    return parseGoogleTranslateResponse(await response.json());
  }

  async translateList(texts: string[], options: { from: string; to: string; timeout?: number }): Promise<string[]> {
    const results: string[] = [];
    for (const text of texts) {
      results.push(await this.translate(text, options));
    }
    return results;
  }

  async testConnection(): Promise<{ ok: true } | { ok: false; error: ProviderError }> {
    try {
      const result = await this.translate('hello', { from: 'en', to: 'zh-CN', timeout: 10000 });
      if (!result.trim()) throw new Error('Empty response from Google Translate');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: classifyError(error) };
    }
  }
}


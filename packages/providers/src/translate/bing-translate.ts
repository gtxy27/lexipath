import { classifyError, type ProviderError } from '../errors';

const DEFAULT_TIMEOUT_MS = 15000;

type BingTokenState = {
  subdomain: string;
  ig: string;
  iid: string;
  key: string;
  token: string;
  tokenTsMs: number;
  tokenExpiryMs: number;
  count: number;
};

function normalizeBingLanguageCode(code: string): string {
  if (!code) return code;
  if (code === 'zh' || code === 'zh-CN') return 'zh-Hans';
  if (code === 'zh-TW') return 'zh-Hant';
  if (code === 'auto') return 'auto-detect';
  return code;
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

function extractBingToken(html: string, responseUrl: string): BingTokenState {
  const igMatch = html.match(/IG:\"([^\"]+)\"/);
  const iidMatch = html.match(/data-iid=\"([a-zA-Z0-9.]+)\"/);
  const paramsMatch = html.match(/params_AbusePreventionHelper\s*=\s*([^\]]+\])/);

  const ig = igMatch?.[1] ?? '';
  const iid = iidMatch?.[1] ?? '';
  const paramsRaw = paramsMatch?.[1] ?? '';

  if (!ig || !iid || !paramsRaw) {
    throw new Error('Failed to parse Bing token from translator page');
  }

  let params: unknown;
  try {
    params = JSON.parse(paramsRaw);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse Bing token params JSON: ${detail}`);
  }
  if (!Array.isArray(params)) {
    throw new Error('Failed to parse Bing token params (expected array)');
  }

  const keyRaw = (params as unknown[])[0];
  const tokenRaw = (params as unknown[])[1];

  const key = typeof keyRaw === 'string' || typeof keyRaw === 'number' ? String(keyRaw) : '';
  const token = typeof tokenRaw === 'string' ? tokenRaw : '';

  if (!key || !token) {
    throw new Error('Failed to parse Bing key/token');
  }

  const now = Date.now();
  let tokenTsMs = now;
  let tokenExpiryMs = 0;

  const otherNumbers = (params as unknown[])
    .slice(1)
    .filter((value) => typeof value === 'number' && Number.isFinite(value)) as number[];

  const largeEpoch =
    (typeof keyRaw === 'number' && Number.isFinite(keyRaw) && keyRaw > 1e11 ? keyRaw : undefined) ??
    otherNumbers.find((value) => value > 1e11);
  const epochSeconds = otherNumbers.find((value) => value > 1e9 && value < 1e11);
  if (largeEpoch) {
    tokenTsMs = largeEpoch;
  } else if (epochSeconds) {
    tokenTsMs = epochSeconds * 1000;
  }

  const remaining = otherNumbers.filter((value) => value !== largeEpoch && value !== epochSeconds);
  tokenExpiryMs = remaining.find((value) => value > 0 && value <= 24 * 60 * 60 * 1000) ?? remaining[0] ?? 0;

  const url = new URL(responseUrl);
  const hostParts = url.hostname.split('.');
  const subdomain = hostParts.length >= 3 ? hostParts[0] ?? 'www' : 'www';

  return {
    subdomain,
    ig,
    iid,
    key,
    token,
    tokenTsMs,
    tokenExpiryMs,
    count: 0,
  };
}

function isTokenExpired(state: BingTokenState): boolean {
  if (!state.tokenExpiryMs) return false;
  return Date.now() - state.tokenTsMs > state.tokenExpiryMs;
}

function parseBingTranslateResponse(raw: unknown): string {
  if (Array.isArray(raw)) {
    const first = raw[0] as any;
    const text = first?.translations?.[0]?.text;
    if (typeof text === 'string') return text;
  }

  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    if ((record as any).ShowCaptcha) {
      throw new Error('Bing Translate requires captcha');
    }
    const statusCode = typeof (record as any).statusCode === 'number' ? (record as any).statusCode : null;
    if (statusCode) {
      const error = new Error('Bing Translate error');
      (error as any).status = statusCode;
      throw error;
    }
  }

  throw new Error('Invalid Bing Translate response');
}

export class BingTranslateProvider {
  private tokenState: BingTokenState | null = null;

  private async ensureToken(timeoutMs: number): Promise<BingTokenState> {
    if (this.tokenState && !isTokenExpired(this.tokenState)) return this.tokenState;

    const response = await fetchWithTimeout(
      'https://www.bing.com/translator',
      { method: 'GET', credentials: 'include' },
      timeoutMs
    );
    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Provider error: ${response.status} - ${errorText}`);
      (error as any).status = response.status;
      (error as any).body = errorText;
      throw error;
    }

    const html = await response.text();
    const state = extractBingToken(html, response.url || 'https://www.bing.com/translator');
    this.tokenState = state;
    return state;
  }

  async translate(text: string, options: { from: string; to: string; timeout?: number }): Promise<string> {
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const state = await this.ensureToken(timeoutMs);

    const from = normalizeBingLanguageCode(options.from);
    const to = normalizeBingLanguageCode(options.to);

    const url = new URL(`https://${state.subdomain}.bing.com/ttranslatev3`);
    url.searchParams.set('isVertical', '1');
    if (state.ig) url.searchParams.set('IG', state.ig);
    if (state.iid) url.searchParams.set('IID', `${state.iid}.${state.count++}`);

    const body = new URLSearchParams({
      fromLang: from,
      to,
      text,
      token: state.token,
      key: state.key,
    });

    const referrer = `https://${state.subdomain}.bing.com/translator`;
    const response = await fetchWithTimeout(
      url.toString(),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
        referrer,
        body: body.toString(),
      },
      timeoutMs
    );

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Provider error: ${response.status} - ${errorText}`);
      (error as any).status = response.status;
      (error as any).body = errorText;
      throw error;
    }

    const raw = await response.json();
    return parseBingTranslateResponse(raw);
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
      const translated = await this.translate('hello', { from: 'en', to: 'zh-CN', timeout: 10000 });
      if (!translated.trim()) throw new Error('Empty response from Bing Translate');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: classifyError(error) };
    }
  }
}

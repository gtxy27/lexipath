const DEFAULT_TRACKING_PARAM_PREFIXES = ['utm_'];

export function isTrackingQueryParam(key: string): boolean {
  const lower = key.trim().toLowerCase();
  if (!lower) return false;
  return DEFAULT_TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

export function isHashRoutingFragment(fragment: string): boolean {
  const trimmed = fragment.trim();
  // common SPA patterns
  return trimmed.startsWith('#/') || trimmed.startsWith('#!/');
}

export function canonicalizeUrlForAnchorKey(url: string): string {
  const raw = url.trim();
  if (!raw) return '';

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return '';
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') return '';

  const host = parsed.host.toLowerCase();
  const path = parsed.pathname || '/';

  const params = new URLSearchParams(parsed.search);
  const keptPairs: Array<[string, string]> = [];
  params.forEach((value, key) => {
    if (isTrackingQueryParam(key)) return;
    keptPairs.push([key, value]);
  });

  keptPairs.sort((a, b) => {
    const k = a[0].localeCompare(b[0]);
    if (k !== 0) return k;
    return a[1].localeCompare(b[1]);
  });

  const query = keptPairs.length
    ? `?${keptPairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`
    : '';

  const hash = (() => {
    const fragment = parsed.hash || '';
    if (!fragment) return '';
    if (isHashRoutingFragment(fragment)) return fragment;
    return '';
  })();

  return `${host}${path}${query}${hash}`;
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufToHex(digest);
}

export async function makeWebAnchorKey(url: string): Promise<string> {
  const canonical = canonicalizeUrlForAnchorKey(url);
  if (!canonical) return '';
  return sha256Hex(canonical);
}

export async function makeSubtitleAnchorKey(anchorId: string): Promise<string> {
  const raw = anchorId.trim();
  if (!raw) return '';
  return sha256Hex(raw);
}

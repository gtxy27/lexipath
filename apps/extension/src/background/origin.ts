export class InvalidOriginError extends Error {
  constructor() {
    super('Invalid origin');
    this.name = 'InvalidOriginError';
  }
}

function isValidIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!part) return false;
    if (!/^\d+$/.test(part)) return false;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isValidIpv4(hostname)) return false;
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const a = Number(parts[0]);
  const b = Number(parts[1]);

  // RFC1918 private IPv4 ranges:
  // - 10.0.0.0/8
  // - 172.16.0.0/12
  // - 192.168.0.0/16
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function normalizeOriginToHostPattern(origin: string): string {
  const trimmed = origin.trim();
  if (!trimmed) throw new InvalidOriginError();
  if (trimmed === '<all_urls>') throw new InvalidOriginError();
  if (trimmed.includes('*')) throw new InvalidOriginError();

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new InvalidOriginError();
  }

  const hostname = stripIpv6Brackets(url.hostname);

  if (url.protocol === 'http:') {
    if (!isLoopbackHost(hostname) && !isPrivateIpv4(hostname)) {
      throw new InvalidOriginError();
    }
  } else if (url.protocol !== 'https:') {
    throw new InvalidOriginError();
  }

  return `${url.origin}/*`;
}

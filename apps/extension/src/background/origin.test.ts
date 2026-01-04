import { describe, expect, it } from 'vitest';

import { InvalidOriginError, normalizeOriginToHostPattern } from './origin';

describe('normalizeOriginToHostPattern', () => {
  it('rejects empty origins', () => {
    expect(() => normalizeOriginToHostPattern('')).toThrow(InvalidOriginError);
    expect(() => normalizeOriginToHostPattern('   ')).toThrow(InvalidOriginError);
  });

  it('rejects <all_urls> and wildcard patterns', () => {
    expect(() => normalizeOriginToHostPattern('<all_urls>')).toThrow(InvalidOriginError);
    expect(() => normalizeOriginToHostPattern('https://example.com/*')).toThrow(InvalidOriginError);
    expect(() => normalizeOriginToHostPattern('https://*.example.com')).toThrow(InvalidOriginError);
  });

  it('rejects invalid URLs', () => {
    expect(() => normalizeOriginToHostPattern('not a url')).toThrow(InvalidOriginError);
    expect(() => normalizeOriginToHostPattern('10.0.0.1:8000')).toThrow(InvalidOriginError);
  });

  it('allows https origins', () => {
    expect(normalizeOriginToHostPattern('https://example.com/v1')).toBe('https://example.com/*');
    expect(normalizeOriginToHostPattern('https://10.0.0.1:8443')).toBe('https://10.0.0.1:8443/*');
  });

  it('allows http loopback origins', () => {
    expect(normalizeOriginToHostPattern('http://localhost:8000')).toBe('http://localhost:8000/*');
    expect(normalizeOriginToHostPattern('http://127.0.0.1:8000')).toBe('http://127.0.0.1:8000/*');
    expect(normalizeOriginToHostPattern('http://[::1]:8000')).toBe('http://[::1]:8000/*');
  });

  it('allows http private-network IPv4 origins', () => {
    expect(normalizeOriginToHostPattern('http://10.126.126.5:8000/v1')).toBe(
      'http://10.126.126.5:8000/*',
    );
    expect(normalizeOriginToHostPattern('http://172.16.0.1:8000')).toBe('http://172.16.0.1:8000/*');
    expect(normalizeOriginToHostPattern('http://192.168.1.10:8000')).toBe('http://192.168.1.10:8000/*');
  });

  it('rejects http public IPv4 origins', () => {
    expect(() => normalizeOriginToHostPattern('http://8.8.8.8:8000')).toThrow(InvalidOriginError);
  });

  it('rejects non-http(s) schemes', () => {
    expect(() => normalizeOriginToHostPattern('ftp://10.0.0.1')).toThrow(InvalidOriginError);
  });
});


import { describe, expect, it } from 'vitest';

import { parseTimeToMs } from './time';

describe('parseTimeToMs', () => {
  it('returns 0 for empty input', () => {
    expect(parseTimeToMs('')).toBe(0);
    expect(parseTimeToMs('   ')).toBe(0);
  });

  it('parses ms and s suffix formats', () => {
    expect(parseTimeToMs('1500ms')).toBe(1500);
    expect(parseTimeToMs('1.5s')).toBe(1500);
    expect(parseTimeToMs('2S')).toBe(2000);
  });

  it('parses hh:mm:ss and mm:ss formats', () => {
    expect(parseTimeToMs('00:01:02.500')).toBe(62_500);
    expect(parseTimeToMs('1:02')).toBe(62_000);
  });

  it('supports comma decimals', () => {
    expect(parseTimeToMs('00:01:02,500')).toBe(62_500);
    expect(parseTimeToMs('1,5')).toBe(1500);
  });

  it('returns 0 for invalid input', () => {
    expect(parseTimeToMs('abc')).toBe(0);
    expect(parseTimeToMs('1:xx')).toBe(0);
  });
});

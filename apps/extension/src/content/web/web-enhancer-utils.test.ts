/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi } from 'vitest';

import { computeTextSignature, extractTextContent, getResolvedTheme, normalizeWordKey } from './web-enhancer-utils';

describe('web-enhancer-utils', () => {
  it('computeTextSignature normalizes whitespace and is stable', () => {
    const a = computeTextSignature('  hello   world  ');
    const b = computeTextSignature('hello world');
    expect(a).toBe(b);

    expect(computeTextSignature('')).toBe('');
    expect(computeTextSignature('   ')).toBe('');
  });

  it('computeTextSignature includes length and changes with content', () => {
    const s1 = computeTextSignature('hello');
    const s2 = computeTextSignature('hello!');
    expect(s1).not.toBe(s2);
    expect(s1.startsWith('5:')).toBe(true);
    expect(s2.startsWith('6:')).toBe(true);
  });

  it('extractTextContent prefers stored dataset value and applies maxTextLength', () => {
    const el = document.createElement('div');
    el.textContent = 'from textContent';
    (el as any).dataset.lxOriginalText = '  from dataset  ';

    expect(extractTextContent(el, 100)).toBe('from dataset');
    expect(extractTextContent(el, 4)).toBe('from');
  });

  it('extractTextContent falls back to textContent when dataset empty', () => {
    const el = document.createElement('div');
    el.textContent = '  hello  ';
    (el as any).dataset.lxOriginalText = '   ';

    expect(extractTextContent(el, 100)).toBe('hello');
  });

  it('normalizeWordKey trims and lowercases', () => {
    expect(normalizeWordKey('  HeLLo ')).toBe('hello');
  });

  it('getResolvedTheme respects explicit theme and system preference', () => {
    const mm = vi.fn(() => ({ matches: true }));
    (window as any).matchMedia = mm;

    expect(getResolvedTheme(null)).toBe('dark');
    expect(getResolvedTheme({ theme: 'dark' } as any)).toBe('dark');
    expect(getResolvedTheme({ theme: 'light' } as any)).toBe('light');

    expect(getResolvedTheme({ theme: 'system' } as any)).toBe('dark');
    expect(mm).toHaveBeenCalledWith('(prefers-color-scheme: dark)');

    (window as any).matchMedia = vi.fn(() => ({ matches: false }));
    expect(getResolvedTheme({ theme: 'system' } as any)).toBe('light');
  });
});

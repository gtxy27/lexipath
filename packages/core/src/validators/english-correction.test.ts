import { describe, expect, it } from 'vitest';
import { validateEnglishCorrectionOutput } from './english-correction';

describe('validateEnglishCorrectionOutput', () => {
  it('returns ok for valid JSON', () => {
    const raw = JSON.stringify({ hasError: false, corrected: null, message: 'OK' });
    const result = validateEnglishCorrectionOutput(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.hasError).toBe(false);
    expect(result.value.corrected).toBeNull();
  });

  it('forces corrected to null when hasError=false', () => {
    const raw = JSON.stringify({ hasError: false, corrected: 'should drop', message: 'OK' });
    const result = validateEnglishCorrectionOutput(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.corrected).toBeNull();
  });

  it('truncates message to 50 chars', () => {
    const raw = JSON.stringify({ hasError: false, corrected: null, message: 'a'.repeat(80) });
    const result = validateEnglishCorrectionOutput(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.message.length).toBe(50);
  });

  it('returns fallback for invalid JSON', () => {
    const result = validateEnglishCorrectionOutput('not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fallback).toEqual({ hasError: false, corrected: null, message: '' });
  });
});


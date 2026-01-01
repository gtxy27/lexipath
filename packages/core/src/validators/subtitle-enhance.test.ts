import { describe, expect, it } from 'vitest';
import { validateSubtitleEnhanceOutput } from './index';

describe('validateSubtitleEnhanceOutput', () => {
  it('returns ok for valid JSON string with line1_final', () => {
    const raw = JSON.stringify({ line1_final: 'Line 1' });
    const result = validateSubtitleEnhanceOutput(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line1_final).toBe('Line 1');
    expect(result.value.line2_final).toBeUndefined();
  });

  it('returns ok when optional lines are present', () => {
    const raw = JSON.stringify({
      line1_final: 'Line 1',
      line2_final: 'Line 2',
      line3_final: 'Line 3',
    });
    const result = validateSubtitleEnhanceOutput(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line2_final).toBe('Line 2');
    expect(result.value.line3_final).toBe('Line 3');
  });

  it('returns ok for JSON wrapped in markdown code block', () => {
    const raw = `\`\`\`json
{
  "line1_final": "Test subtitle",
  "line2_final": "测试字幕"
}
\`\`\``;

    const result = validateSubtitleEnhanceOutput(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line1_final).toBe('Test subtitle');
    expect(result.value.line2_final).toBe('测试字幕');
  });

  it('returns ok for legacy nested corrected_results shape', () => {
    const raw = JSON.stringify({
      validation: {
        corrected_results: {
          line1_final: 'Nested line 1',
          line2_final: 'Nested line 2',
        },
      },
    });

    const result = validateSubtitleEnhanceOutput(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line1_final).toBe('Nested line 1');
    expect(result.value.line2_final).toBe('Nested line 2');
  });

  it('returns fallback when line1_final is missing', () => {
    const raw = JSON.stringify({ line2_final: 'Line 2' });
    const result = validateSubtitleEnhanceOutput(raw);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fallback.line1_final).toBe('');
  });

  it('returns fallback for invalid JSON', () => {
    const result = validateSubtitleEnhanceOutput('not valid json');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fallback).toEqual({ line1_final: '' });
  });
});


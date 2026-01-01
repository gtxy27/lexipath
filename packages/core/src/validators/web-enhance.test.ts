import { describe, expect, it } from 'vitest';
import { validateWebEnhanceOutput } from './index';

describe('validateWebEnhanceOutput', () => {
  it('returns ok for valid JSON string', () => {
    const raw = JSON.stringify({
      content_result: 'This is a test',
      convert_word: [{ original: 'test', converted: '测试', difficulty: 'A2' }],
    });

    const result = validateWebEnhanceOutput(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content_result).toBe('This is a test');
    expect(result.value.convert_word).toHaveLength(1);
  });

  it('returns ok for JSON wrapped in markdown code block', () => {
    const raw = `\`\`\`json
{
  "content_result": "Hello",
  "convert_word": []
}
\`\`\``;

    const result = validateWebEnhanceOutput(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content_result).toBe('Hello');
    expect(result.value.convert_word).toEqual([]);
  });

  it('returns fallback for invalid JSON', () => {
    const result = validateWebEnhanceOutput('not valid json');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fallback).toEqual({ content_result: '' });
  });

  it('returns fallback when content_result is missing', () => {
    const raw = JSON.stringify({ convert_word: [] });
    const result = validateWebEnhanceOutput(raw);

    expect(result.ok).toBe(false);
  });

  it('accepts already-parsed objects', () => {
    const result = validateWebEnhanceOutput({
      content_result: 'Already parsed',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content_result).toBe('Already parsed');
  });

  it('rejects output with length inflation >= 2x when baseline is available', () => {
    const result = validateWebEnhanceOutput({
      content_original: 'hello', // length 5
      content_result: 'helloworld', // length 10 => 2x (reject; must be < 2)
    });

    expect(result.ok).toBe(false);
  });

  it('accepts output with length inflation < 2x when baseline is available', () => {
    const result = validateWebEnhanceOutput({
      content_original: 'a'.repeat(10),
      content_result: 'b'.repeat(19), // 1.9x
    });

    expect(result.ok).toBe(true);
  });
});


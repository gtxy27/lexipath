import { describe, expect, it } from 'vitest';

import { validateFullRewriteGuard } from './guard';

describe('validateFullRewriteGuard', () => {
  it('returns empty when original or rewritten is blank', () => {
    expect(validateFullRewriteGuard({ original: '', rewritten: 'x' })).toEqual({ ok: false, reason: 'empty' });
    expect(validateFullRewriteGuard({ original: 'x', rewritten: '   ' })).toEqual({ ok: false, reason: 'empty' });
  });

  it('returns length_drift for large length changes', () => {
    const original = 'a'.repeat(60);

    expect(validateFullRewriteGuard({ original, rewritten: 'short' })).toEqual({ ok: false, reason: 'length_drift' });

    const rewrittenTooLong = 'b'.repeat(Math.ceil(60 * 2.2) + 1);
    expect(validateFullRewriteGuard({ original, rewritten: rewrittenTooLong })).toEqual({ ok: false, reason: 'length_drift' });
  });

  it('returns ban_phrase when model disclaimer phrases appear', () => {
    expect(
      validateFullRewriteGuard({
        original: 'Normal text.',
        rewritten: 'As an AI, I cannot do that.',
      }),
    ).toEqual({ ok: false, reason: 'ban_phrase' });
  });

  it('returns unexpected_script when both sides are mostly CJK', () => {
    expect(
      validateFullRewriteGuard({
        original: '\u4f60\u597d\uff0c\u8fd9\u662f\u539f\u6587\u3002',
        rewritten: '\u3053\u3093\u306b\u3061\u306f\u3001\u66f8\u304d\u63db\u3048\u3067\u3059\u3002',
      }),
    ).toEqual({ ok: false, reason: 'unexpected_script' });
  });

  it('returns hard_token_missing when too many original tokens disappear', () => {
    const tokens = Array.from({ length: 20 }, (_v, i) => `token${i + 1}`);
    const original = tokens.join(' ');

    // Keep length roughly similar, but remove 3 tokens; for 20 tokens the allowed missing is 2.
    const rewritten = tokens.slice(0, 17).join(' ');

    expect(validateFullRewriteGuard({ original, rewritten })).toEqual({ ok: false, reason: 'hard_token_missing' });
  });

  it('returns low_diversity for long, repetitive output', () => {
    const rewritten = Array.from({ length: 200 }, () => 'foo').join(' ');
    expect(rewritten.length).toBeGreaterThan(160);

    expect(
      validateFullRewriteGuard({
        // Use a token-less original so token fidelity does not block this path.
        original: '!!!',
        rewritten,
      }),
    ).toEqual({ ok: false, reason: 'low_diversity' });
  });

  it('returns repeated_sentence for repeated consecutive sentences', () => {
    expect(
      validateFullRewriteGuard({
        original: 'Hello there.',
        rewritten: 'Hello. Hello. Hello. Hello.',
      }),
    ).toEqual({ ok: false, reason: 'repeated_sentence' });
  });

  it('returns sentence_count_drift when sentence counts drift too far', () => {
    // Use token-less sentences so hard-token fidelity does not trigger first.
    const original = '###. $$$. @@@. ---.';
    const rewritten = '###.';

    expect(validateFullRewriteGuard({ original, rewritten })).toEqual({ ok: false, reason: 'sentence_count_drift' });
  });

  it('returns cjk_ratio when rewritten contains too much CJK', () => {
    expect(
      validateFullRewriteGuard({
        original: 'abc',
        rewritten: 'abc 你好你好你好你好你好',
      }),
    ).toEqual({ ok: false, reason: 'cjk_ratio' });
  });

  it('returns ok for a reasonable rewrite', () => {
    expect(
      validateFullRewriteGuard({
        original: 'This is fine.',
        rewritten: 'This is fine too.',
      }),
    ).toEqual({ ok: true, reason: 'ok' });
  });
});

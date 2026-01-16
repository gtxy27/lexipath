export type FullRewriteGuardReason =
  | 'empty'
  | 'length_drift'
  | 'ban_phrase'
  | 'unexpected_script'
  | 'hard_token_missing'
  | 'low_diversity'
  | 'repeated_sentence'
  | 'sentence_count_drift'
  | 'cjk_ratio'
  | 'ok';

function countSentences(text: string): number {
  const parts = text
    .replace(/\s+/g, ' ')
    .split(/[.!?。！？]+/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length;
}

function uniqueTokenRatio(text: string): number {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
  if (tokens.length === 0) return 1;
  const unique = new Set(tokens);
  return unique.size / tokens.length;
}

function hasRepeatedSentence(text: string): boolean {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/[.!?。！？]+/g)
    .map((p) => p.trim())
    .filter(Boolean);
  if (sentences.length < 4) return false;
  let streak = 1;
  for (let i = 1; i < sentences.length; i += 1) {
    const current = sentences[i];
    const prev = sentences[i - 1];
    if (!current || !prev) continue;
    if (current.toLowerCase() === prev.toLowerCase()) {
      streak += 1;
      if (streak > 2) return true;
    } else {
      streak = 1;
    }
  }
  return false;
}

function cjkRatio(text: string): number {
  const total = text.length;
  if (!total) return 0;
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk += 1;
    }
  }
  return cjk / total;
}

function countScriptLetters(text: string): { latin: number; han: number; kana: number; hangul: number } {
  let latin = 0;
  let han = 0;
  let kana = 0;
  let hangul = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1;
    else if (code >= 0x4e00 && code <= 0x9fff) han += 1;
    else if (code >= 0x3040 && code <= 0x30ff) kana += 1;
    else if (code >= 0xac00 && code <= 0xd7af) hangul += 1;
  }
  return { latin, han, kana, hangul };
}

function countNonWhitespaceChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}

function extractHardTokens(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_]+/g) ?? [];
  return matches.map((m) => m.trim()).filter(Boolean);
}

function hardTokenFidelity(original: string, rewritten: string): { ok: boolean; missing: number; total: number } {
  const tokens = extractHardTokens(original);
  if (tokens.length === 0) return { ok: true, missing: 0, total: 0 };
  const missing = tokens.filter((t) => !rewritten.includes(t)).length;
  return { ok: missing <= Math.max(1, Math.floor(tokens.length * 0.1)), missing, total: tokens.length };
}

function hasBanPhrases(text: string): boolean {
  const hay = text.toLowerCase();
  return (
    hay.includes('as an ai') ||
    hay.includes('as a language model') ||
    hay.includes('i can’t') ||
    hay.includes("i can't") ||
    hay.includes('i cannot')
  );
}

export function validateFullRewriteGuard(options: {
  original: string;
  rewritten: string;
}): { ok: boolean; reason: FullRewriteGuardReason } {
  const original = options.original.trim();
  const rewritten = options.rewritten.trim();
  if (!original || !rewritten) return { ok: false, reason: 'empty' };

  const oLen = countNonWhitespaceChars(original);
  const rLen = countNonWhitespaceChars(rewritten);
  if (oLen >= 60 && (rLen < Math.floor(oLen * 0.5) || rLen > Math.ceil(oLen * 2.2))) {
    return { ok: false, reason: 'length_drift' };
  }

  if (hasBanPhrases(rewritten)) {
    return { ok: false, reason: 'ban_phrase' };
  }

  const { latin: oLatin, han: oHan, kana: oKana, hangul: oHangul } = countScriptLetters(original);
  const { latin: rLatin, han: rHan, kana: rKana, hangul: rHangul } = countScriptLetters(rewritten);
  const oCjk = oHan + oKana + oHangul;
  const rCjk = rHan + rKana + rHangul;
  if (oCjk > oLatin && rCjk > rLatin) {
    return { ok: false, reason: 'unexpected_script' };
  }

  const fidelity = hardTokenFidelity(original, rewritten);
  if (!fidelity.ok) {
    return { ok: false, reason: 'hard_token_missing' };
  }

  if (uniqueTokenRatio(rewritten) < 0.22 && rewritten.length > 160) {
    return { ok: false, reason: 'low_diversity' };
  }

  if (hasRepeatedSentence(rewritten)) {
    return { ok: false, reason: 'repeated_sentence' };
  }

  const s1 = countSentences(original);
  const s2 = countSentences(rewritten);
  if (s1 >= 3 && (s2 < Math.floor(s1 * 0.5) || s2 > Math.ceil(s1 * 2.0))) {
    return { ok: false, reason: 'sentence_count_drift' };
  }

  if (cjkRatio(rewritten) > 0.15) {
    return { ok: false, reason: 'cjk_ratio' };
  }

  return { ok: true, reason: 'ok' };
}

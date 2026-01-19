import { lowerForMatch, type Cue, type SupportedLanguage } from '@lexipath/core';

export function normalizeSupportedLanguageCode(languageCode: string): SupportedLanguage | null {
  const normalized = languageCode.trim().toLowerCase();
  if (!normalized) return null;

  const parts = normalized.split(/[-_]/).filter(Boolean);
  for (const part of parts) {
    switch (part) {
      case 'en':
      case 'ja':
      case 'ko':
      case 'fr':
      case 'de':
      case 'zh':
        return part;
      default:
        break;
    }
  }

  return null;
}

export function normalizeTerm(term: string): string {
  return lowerForMatch(term).replace(/\s+/g, ' ').trim();
}

export function computeTextSignature(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) + normalized.charCodeAt(i);
    hash |= 0;
  }

  return `${normalized.length}:${hash >>> 0}`;
}

export function clampContextSentences(raw: unknown, max: number = 6): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
  return Math.max(0, Math.min(max, n));
}

export function buildCueContextWindow(options: {
  cues: Cue[];
  centerIndex: number;
  centerText: string;
  windowSize: number;
}): { before: string[]; after: string[] } {
  const windowSize = Math.max(0, Math.min(6, Math.floor(options.windowSize)));
  if (windowSize <= 0) return { before: [], after: [] };

  const before: string[] = [];
  const after: string[] = [];

  const cues = options.cues;
  const centerIndex = options.centerIndex;
  const start = Math.max(0, centerIndex - windowSize);
  const end = Math.min(cues.length - 1, centerIndex + windowSize);

  for (let i = start; i <= end; i += 1) {
    if (i === centerIndex) continue;
    const cue = cues[i];
    const text = cue?.text?.trim?.() ?? '';
    if (!text) continue;
    if (i < centerIndex) before.push(text);
    else after.push(text);
  }

  // Always include the current line in context to disambiguate senses.
  const center = options.centerText.trim();
  if (center) {
    before.push(center);
  }

  return { before, after };
}

export function computeContextSignature(window: { before: string[]; after: string[] }): string {
  const joined = [...window.before, '||', ...window.after].join('\n').trim();
  if (!joined) return '';
  return computeTextSignature(joined);
}

export function computeKeywordTranslationSignature(text: string, keywords: string[]): string {
  const normalizedKeywords = keywords.map((term) => normalizeTerm(term)).filter(Boolean);
  normalizedKeywords.sort((a, b) => a.localeCompare(b));
  return `${computeTextSignature(text)}|${normalizedKeywords.join('|')}`;
}

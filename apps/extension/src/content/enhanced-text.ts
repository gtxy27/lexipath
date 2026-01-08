import type { CEFRLevel, WebEnhanceMode, WebEnhanceOutput } from '@lexipath/core';
import { getWordColor } from '../shared/word-colors';

export type WordRenderMode = 'target-to-native' | 'native-to-target';

type WordFamiliarityLite = { familiarity: number; encounters: number };

/**
 * Create enhanced text fragment with word highlighting.
 * Must be deterministic and support repeated occurrences.
 */
export function createEnhancedElement(
  original: string,
  enhanced: WebEnhanceOutput,
  mode: WordRenderMode,
  options?: {
    webEnhanceMode?: WebEnhanceMode;
    userLevel?: CEFRLevel;
    styleMapping?: { within: string; out: string; forgotten: string };
    familiarityByWord?: Record<string, WordFamiliarityLite | undefined>;
  }
): DocumentFragment {
  const fragment = document.createDocumentFragment();

  if (!enhanced.convert_word || enhanced.convert_word.length === 0) {
    fragment.appendChild(document.createTextNode(original));
    return fragment;
  }

  const currentText = original;
  const currentLower = currentText.toLowerCase();
  const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const webEnhanceMode: WebEnhanceMode = options?.webEnhanceMode ?? 'i_plus_1';
  const userLevel: CEFRLevel | undefined = options?.userLevel;
  const styleMapping = options?.styleMapping ?? { within: 'dashedLine', out: 'border', forgotten: 'weakened' };
  const showInlineNativeHint = webEnhanceMode === 'light';
  // plan15 (mode spec) DONE: Light shows inline native hint in parentheses for native-to-target mode; i+1 does not.

  const CEFR_ORDER: readonly CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const cefrRank = (level: CEFRLevel) => {
    const idx = CEFR_ORDER.indexOf(level);
    return idx < 0 ? 0 : idx;
  };
  const parseCefrLevel = (raw: unknown): CEFRLevel | null => {
    if (typeof raw !== 'string') return null;
    const normalized = raw.trim().toUpperCase();
    return (CEFR_ORDER as readonly string[]).includes(normalized) ? (normalized as CEFRLevel) : null;
  };

  const words = enhanced.convert_word
    .map((word) => ({
      ...word,
      originalLower: word.original.toLowerCase(),
      enforceWordBoundary: /[A-Za-z]/.test(word.original),
    }))
    .filter((word) => word.originalLower.trim().length > 0);

  const buildOffsetsFromTerms = (text: string, terms: string[]) => {
    const haystack = text.toLowerCase();
    const uniqueTerms = Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean)));
    uniqueTerms.sort((a, b) => b.length - a.length);

    const taken: Array<{ start: number; end: number }> = [];
    const offsets: Array<{ start: number; end: number; term: string }> = [];
    const overlaps = (start: number, end: number) =>
      taken.some((range) => !(end <= range.start || start >= range.end));

    for (const term of uniqueTerms) {
      const needleLower = term.toLowerCase();
      const len = needleLower.length;
      if (!len) continue;

      let idx = 0;
      while (idx < haystack.length) {
        const found = haystack.indexOf(needleLower, idx);
        if (found === -1) break;
        idx = found + len;

        const enforceBoundary = /[A-Za-z]/.test(term);
        if (enforceBoundary && !hasWordBoundary(found, len)) continue;
        if (overlaps(found, found + len)) continue;

        taken.push({ start: found, end: found + len });
        offsets.push({ start: found, end: found + len, term });
      }
    }

    offsets.sort((a, b) => a.start - b.start);
    return offsets;
  };

  const normalizeOffsets = (raw: unknown): Array<{ start: number; end: number; term?: string }> => {
    if (!Array.isArray(raw)) return [];
    const cleaned = raw
      .map((item) => item as any)
      .filter((item) => item && Number.isFinite(item.start) && Number.isFinite(item.end))
      .map((item) => ({
        start: Math.max(0, Math.floor(item.start)),
        end: Math.max(0, Math.floor(item.end)),
        ...(typeof item.term === 'string' && item.term.trim() ? { term: item.term.trim() } : {}),
      }))
      .filter((item) => item.end > item.start && item.end <= currentText.length)
      .sort((a, b) => a.start - b.start);

    const out: Array<{ start: number; end: number; term?: string }> = [];
    let lastEnd = -1;
    for (const item of cleaned) {
      if (item.start < lastEnd) continue;
      out.push(item);
      lastEnd = item.end;
    }
    return out;
  };

  const isWordCharCode = (code: number) => {
    if (!Number.isFinite(code)) return false;
    return (
      (code >= 0x41 && code <= 0x5a) || // A-Z
      (code >= 0x61 && code <= 0x7a) || // a-z
      (code >= 0x30 && code <= 0x39) || // 0-9
      code === 0x5f // _
    );
  };
  const hasWordBoundary = (start: number, length: number) => {
    const beforeCode = start > 0 ? currentText.charCodeAt(start - 1) : Number.NaN;
    const afterCode = start + length < currentText.length ? currentText.charCodeAt(start + length) : Number.NaN;
    return !isWordCharCode(beforeCode) && !isWordCharCode(afterCode);
  };

  const candidatesByFirstChar = new Map<string, (typeof words)[number][]>();
  for (const word of words) {
    const firstChar = word.originalLower[0];
    if (!firstChar) continue;
    const list = candidatesByFirstChar.get(firstChar);
    if (list) list.push(word);
    else candidatesByFirstChar.set(firstChar, [word]);
  }
  for (const list of candidatesByFirstChar.values()) {
    list.sort((a, b) => b.originalLower.length - a.originalLower.length);
  }

  let cursor = 0;
  let plainStart = 0;

  const offsets = (() => {
    const rawOffsets = normalizeOffsets((enhanced as any).highlight_offsets);
    if (rawOffsets.length > 0) return rawOffsets;

    const terms = Array.isArray((enhanced as any).highlight_terms)
      ? ((enhanced as any).highlight_terms as string[])
      : words.map((w) => w.original);
    return normalizeOffsets(buildOffsetsFromTerms(currentText, terms));
  })();

  const wordByLower = new Map<string, (typeof words)[number]>();
  for (const word of words) {
    if (!wordByLower.has(word.originalLower)) wordByLower.set(word.originalLower, word);
  }

  if (offsets.length > 0) {
    for (const off of offsets) {
      const start = off.start;
      const end = off.end;
      if (plainStart < start) {
        fragment.appendChild(document.createTextNode(currentText.slice(plainStart, start)));
      }

      const matchedOriginal = currentText.slice(start, end);
      const matchedLower = matchedOriginal.toLowerCase();
      const byMatched = wordByLower.get(matchedLower);
      const byTerm = off.term ? wordByLower.get(off.term.toLowerCase()) : undefined;
      const bestWord = byMatched ?? byTerm ?? null;

      if (!bestWord) {
        fragment.appendChild(document.createTextNode(matchedOriginal));
        plainStart = end;
        continue;
      }

      const span = document.createElement('span');
      span.className = 'lexipath-word';
      const color = getWordColor(bestWord.partOfSpeech, isDarkMode);
      span.style.setProperty('--lx-word-color', color);
      span.dataset.original = matchedOriginal;
      span.dataset.surface = matchedOriginal;
      span.dataset.converted = bestWord.converted;
      span.dataset.lookup = mode === 'native-to-target' ? bestWord.converted : matchedOriginal;
      span.dataset.difficulty = bestWord.difficulty || '';
      span.dataset.partOfSpeech = bestWord.partOfSpeech || '';
      span.dataset.renderMode = mode;

      const normalizedKey = bestWord.originalLower;
      const familiarity = options?.familiarityByWord?.[normalizedKey];
      if (familiarity) {
        span.dataset.familiarity = String(familiarity.familiarity);
        span.dataset.encounters = String(familiarity.encounters);
      }

      const isForgotten =
        familiarity && familiarity.encounters >= 2 && familiarity.familiarity < 30;

      const isOutOfLevel = (() => {
        // plan15: "uncertain" defaults to low-friction out-of-level.
        if (!userLevel) return true;
        const wordLevel =
          (bestWord as any).difficultyLevel ?? parseCefrLevel((bestWord as any).difficulty);
        const confidence =
          typeof (bestWord as any).difficultyConfidence === 'number'
            ? (bestWord as any).difficultyConfidence
            : 0;
        if (!wordLevel) return true;
        if (confidence < 0.55) return true;
        return cefrRank(wordLevel) > cefrRank(userLevel);
      })();

      const styleKey = isForgotten
        ? styleMapping.forgotten
        : isOutOfLevel
          ? styleMapping.out
          : styleMapping.within;
      span.dataset.lxStyle = styleKey;

      const enhancedText = (() => {
        if (mode !== 'native-to-target') return matchedOriginal;
        return showInlineNativeHint ? `${bestWord.converted} (${matchedOriginal})` : bestWord.converted;
      })();

      const enhancedEl = document.createElement('span');
      enhancedEl.className = 'lexipath-word__enhanced';
      enhancedEl.textContent = enhancedText;

      const originalEl = document.createElement('span');
      originalEl.className = 'lexipath-word__original';
      originalEl.textContent = matchedOriginal;

      span.appendChild(enhancedEl);
      span.appendChild(originalEl);

      const tooltipText = mode === 'native-to-target' ? matchedOriginal : bestWord.converted;
      span.dataset.tooltip = `${tooltipText}${bestWord.difficulty ? ` (${bestWord.difficulty})` : ''}`;
      span.removeAttribute('title');

      fragment.appendChild(span);
      plainStart = end;
    }

    if (plainStart < currentText.length) {
      fragment.appendChild(document.createTextNode(currentText.slice(plainStart)));
    }

    return fragment;
  }

  while (cursor < currentText.length) {
    const candidates = candidatesByFirstChar.get(currentLower[cursor] ?? '');
    let bestWord: (typeof words)[number] | null = null;
    let bestLength = 0;

    if (candidates) {
      for (const word of candidates) {
        const needle = word.originalLower;
        const length = needle.length;
        if (!length) continue;
        if (!currentLower.startsWith(needle, cursor)) continue;
        if (word.enforceWordBoundary && !hasWordBoundary(cursor, length)) continue;
        bestWord = word;
        bestLength = length;
        break;
      }
    }

    if (!bestWord || bestLength <= 0) {
      cursor += 1;
      continue;
    }

    if (plainStart < cursor) {
      fragment.appendChild(document.createTextNode(currentText.slice(plainStart, cursor)));
    }

    const span = document.createElement('span');
    span.className = 'lexipath-word';
    const color = getWordColor(bestWord.partOfSpeech, isDarkMode);
    const matchedOriginal = currentText.slice(cursor, cursor + bestLength);
    
    span.style.setProperty('--lx-word-color', color);
    span.dataset.original = matchedOriginal;
    span.dataset.surface = matchedOriginal;
    span.dataset.converted = bestWord.converted;
    span.dataset.lookup = mode === 'native-to-target' ? bestWord.converted : matchedOriginal;
    span.dataset.difficulty = bestWord.difficulty || '';
    span.dataset.difficultyLevel = (bestWord as any).difficultyLevel || '';
    span.dataset.difficultyConfidence =
      typeof (bestWord as any).difficultyConfidence === 'number'
        ? String((bestWord as any).difficultyConfidence)
        : '';
    span.dataset.partOfSpeech = bestWord.partOfSpeech || '';
    span.dataset.renderMode = mode;

    const normalizedKey = bestWord.originalLower;
    const familiarity = options?.familiarityByWord?.[normalizedKey];
    if (familiarity) {
      span.dataset.familiarity = String(familiarity.familiarity);
      span.dataset.encounters = String(familiarity.encounters);
    }

    const isForgotten =
      familiarity && familiarity.encounters >= 2 && familiarity.familiarity < 30;
    const isWithin = familiarity && familiarity.familiarity >= 60;
    const styleKey = isForgotten
      ? styleMapping.forgotten
      : isWithin
        ? styleMapping.within
        : styleMapping.out;
    span.dataset.lxStyle = styleKey;

    const enhancedText = (() => {
      if (mode !== 'native-to-target') return matchedOriginal;
      return showInlineNativeHint ? `${bestWord.converted} (${matchedOriginal})` : bestWord.converted;
    })();

    const enhancedEl = document.createElement('span');
    enhancedEl.className = 'lexipath-word__enhanced';
    enhancedEl.textContent = enhancedText;

    const originalEl = document.createElement('span');
    originalEl.className = 'lexipath-word__original';
    originalEl.textContent = matchedOriginal;

    span.appendChild(enhancedEl);
    span.appendChild(originalEl);

    const tooltipText = mode === 'native-to-target' ? matchedOriginal : bestWord.converted;
    span.dataset.tooltip = `${tooltipText}${bestWord.difficulty ? ` (${bestWord.difficulty})` : ''}`;
    span.removeAttribute('title');

    fragment.appendChild(span);
    cursor += bestLength;
    plainStart = cursor;
  }

  if (plainStart < currentText.length) {
    fragment.appendChild(document.createTextNode(currentText.slice(plainStart)));
  }

  return fragment;
}

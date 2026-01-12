import { lowerForMatch, type CEFRLevel, type WebEnhanceMode, type WebEnhanceOutput } from '@lexipath/core';
import { getWordColor } from '../shared/word-colors';
import { Trie } from './trie';

export type WordRenderMode = 'target-to-native' | 'native-to-target';

type WordFamiliarityLite = { familiarity: number; encounters: number };

export type EnhancedTextOptions = {
  webEnhanceMode?: WebEnhanceMode;
  userLevel?: CEFRLevel;
  styleMapping?: { within: string; out: string; forgotten: string };
  familiarityByWord?: Record<string, WordFamiliarityLite | undefined>;
  isDarkMode?: boolean;
};

/**
 * Lowercase in a way that preserves string length (code units) so indexes remain valid for slicing.
 * JS `toLowerCase()` can expand some characters (e.g. U+0130 "İ"), which breaks offset-based matching.
 */
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

/**
 * Create enhanced text fragment with word highlighting.
 * Must be deterministic and support repeated occurrences.
 */
export function createEnhancedElement(
  original: string,
  enhanced: WebEnhanceOutput,
  mode: WordRenderMode,
  options?: EnhancedTextOptions,
): DocumentFragment {
  const fragment = document.createDocumentFragment();

  if (!enhanced.convert_word || enhanced.convert_word.length === 0) {
    fragment.appendChild(document.createTextNode(original));
    return fragment;
  }

  const currentText = original;
  const currentLower = lowerForMatch(currentText);
  const isDarkMode =
    typeof options?.isDarkMode === 'boolean'
      ? options.isDarkMode
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const webEnhanceMode: WebEnhanceMode = options?.webEnhanceMode ?? 'i_plus_1';
  const userLevel: CEFRLevel | undefined = options?.userLevel;
  const styleMapping = options?.styleMapping ?? { within: 'dashedLine', out: 'border', forgotten: 'weakened' };
  const showInlineNativeHint = webEnhanceMode === 'light';
  // plan15 (mode spec) DONE: Light shows inline native hint in parentheses for native-to-target mode; i+1 does not.

  const words = enhanced.convert_word
    .map((word) => ({
      ...word,
      originalLower: lowerForMatch(word.original),
      enforceWordBoundary: /[A-Za-z]/.test(word.original),
    }))
    .filter((word) => word.originalLower.trim().length > 0);

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

  // Build Trie for O(n) matching instead of O(n*m)
  const trie = new Trie();
  const wordByLower = new Map<string, (typeof words)[number]>();
  
  for (const word of words) {
    trie.insert(word.originalLower, word);
    if (!wordByLower.has(word.originalLower)) {
      wordByLower.set(word.originalLower, word);
    }
  }

  let cursor = 0;
  let plainStart = 0;

  // Prefer local, deterministic matching to avoid server-provided offset drift.
  // If offsets include `term` and they match exactly, we can use them; otherwise fall back to Trie matching.
  const offsets = (() => {
    const rawOffsets = normalizeOffsets(enhanced.highlight_offsets).filter(
      (off) => typeof off.term === 'string' && off.term.trim().length > 0,
    );
    if (rawOffsets.length === 0) return [];

    for (const off of rawOffsets) {
      const matched = currentText.slice(off.start, off.end);
      if (lowerForMatch(matched) !== lowerForMatch(off.term!)) return [];
    }

    return rawOffsets;
  })();

  if (offsets.length > 0) {
    for (const off of offsets) {
      const start = off.start;
      const end = off.end;
      if (plainStart < start) {
        fragment.appendChild(document.createTextNode(currentText.slice(plainStart, start)));
      }

      const matchedOriginal = currentText.slice(start, end);
      const matchedLower = lowerForMatch(matchedOriginal);
      const byMatched = wordByLower.get(matchedLower);
      const byTerm = off.term ? wordByLower.get(lowerForMatch(off.term)) : undefined;
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
          bestWord.difficultyLevel ?? parseCefrLevel(bestWord.difficulty);
        const confidence =
          typeof bestWord.difficultyConfidence === 'number'
            ? bestWord.difficultyConfidence
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

  // Use Trie for O(n) matching
  while (cursor < currentText.length) {
    const matches = trie.findMatchesAt(currentLower, cursor);
    let bestWord: (typeof words)[number] | null = null;
    let bestLength = 0;

    // Find longest match that satisfies word boundary requirements
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      if (!match) continue;
      
      const wordData = match.wordData;
      if (!wordData) continue;

      if (wordData.enforceWordBoundary && !hasWordBoundary(cursor, match.length)) {
        continue;
      }

      bestWord = wordData;
      bestLength = match.length;
      break;
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
    span.dataset.difficultyLevel = bestWord.difficultyLevel || '';
    span.dataset.difficultyConfidence =
      typeof bestWord.difficultyConfidence === 'number'
        ? String(bestWord.difficultyConfidence)
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

    const isOutOfLevel = (() => {
      // plan15: "uncertain" defaults to low-friction out-of-level.
      if (!userLevel) return true;
      const wordLevel =
        bestWord.difficultyLevel ?? parseCefrLevel(bestWord.difficulty);
      const confidence =
        typeof bestWord.difficultyConfidence === 'number'
          ? bestWord.difficultyConfidence
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
    cursor += bestLength;
    plainStart = cursor;
  }

  if (plainStart < currentText.length) {
    fragment.appendChild(document.createTextNode(currentText.slice(plainStart)));
  }

  return fragment;
}

/**
 * Create a renderer that reuses expensive per-paragraph setup (Trie/term set) across multiple text nodes.
 * This is important because we may call the renderer dozens of times per paragraph when preserving inline markup.
 */
export function createEnhancedRenderer(
  enhanced: WebEnhanceOutput,
  mode: WordRenderMode,
  options?: EnhancedTextOptions,
): (original: string) => DocumentFragment {
  if (!enhanced.convert_word || enhanced.convert_word.length === 0) {
    return (original: string) => {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode(original));
      return fragment;
    };
  }

  const isDarkMode =
    typeof options?.isDarkMode === 'boolean'
      ? options.isDarkMode
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const webEnhanceMode: WebEnhanceMode = options?.webEnhanceMode ?? 'i_plus_1';
  const userLevel: CEFRLevel | undefined = options?.userLevel;
  const styleMapping =
    options?.styleMapping ?? { within: 'dashedLine', out: 'border', forgotten: 'weakened' };
  const showInlineNativeHint = webEnhanceMode === 'light';

  const words = enhanced.convert_word
    .map((word) => ({
      ...word,
      originalLower: lowerForMatch(word.original),
      enforceWordBoundary: /[A-Za-z]/.test(word.original),
    }))
    .filter((word) => word.originalLower.trim().length > 0);

  if (words.length === 0) {
    return (original: string) => {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode(original));
      return fragment;
    };
  }

  // Build Trie once for O(n) matching instead of O(n*m).
  const trie = new Trie();
  const wordByLower = new Map<string, (typeof words)[number]>();
  for (const word of words) {
    trie.insert(word.originalLower, word);
    if (!wordByLower.has(word.originalLower)) {
      wordByLower.set(word.originalLower, word);
    }
  }

  const isWordCharCode = (code: number) => {
    if (!Number.isFinite(code)) return false;
    return (
      (code >= 0x41 && code <= 0x5a) || // A-Z
      (code >= 0x61 && code <= 0x7a) || // a-z
      (code >= 0x30 && code <= 0x39) || // 0-9
      code === 0x5f // _
    );
  };

  return (original: string) => {
    const fragment = document.createDocumentFragment();

    const currentText = original;
    const currentLower = lowerForMatch(currentText);

    const hasWordBoundary = (start: number, length: number) => {
      const beforeCode = start > 0 ? currentText.charCodeAt(start - 1) : Number.NaN;
      const afterCode = start + length < currentText.length ? currentText.charCodeAt(start + length) : Number.NaN;
      return !isWordCharCode(beforeCode) && !isWordCharCode(afterCode);
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

    let cursor = 0;
    let plainStart = 0;

    const offsets = (() => {
      const rawOffsets = normalizeOffsets(enhanced.highlight_offsets).filter(
        (off) => typeof off.term === 'string' && off.term.trim().length > 0,
      );
      if (rawOffsets.length === 0) return [];

      for (const off of rawOffsets) {
        const matched = currentText.slice(off.start, off.end);
        if (lowerForMatch(matched) !== lowerForMatch(off.term!)) return [];
      }

      return rawOffsets;
    })();

    if (offsets.length > 0) {
      for (const off of offsets) {
        const start = off.start;
        const end = off.end;
        if (plainStart < start) {
          fragment.appendChild(document.createTextNode(currentText.slice(plainStart, start)));
        }

        const matchedOriginal = currentText.slice(start, end);
        const matchedLower = lowerForMatch(matchedOriginal);
        const byMatched = wordByLower.get(matchedLower);
        const byTerm = off.term ? wordByLower.get(lowerForMatch(off.term)) : undefined;
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
          if (!userLevel) return true;
          const wordLevel =
            bestWord.difficultyLevel ?? parseCefrLevel(bestWord.difficulty);
          const confidence =
            typeof bestWord.difficultyConfidence === 'number'
              ? bestWord.difficultyConfidence
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

    // Use Trie for O(n) matching.
    while (cursor < currentText.length) {
      const matches = trie.findMatchesAt(currentLower, cursor);
      let bestWord: (typeof words)[number] | null = null;
      let bestLength = 0;

      // Find longest match that satisfies word boundary requirements.
      for (let i = matches.length - 1; i >= 0; i--) {
        const match = matches[i];
        if (!match) continue;

        const wordData = match.wordData;
        if (!wordData) continue;

        if (wordData.enforceWordBoundary && !hasWordBoundary(cursor, match.length)) {
          continue;
        }

        bestWord = wordData;
        bestLength = match.length;
        break;
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
      span.dataset.difficultyLevel = bestWord.difficultyLevel || '';
      span.dataset.difficultyConfidence =
        typeof bestWord.difficultyConfidence === 'number'
          ? String(bestWord.difficultyConfidence)
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

      const isOutOfLevel = (() => {
        if (!userLevel) return true;
        const wordLevel =
          bestWord.difficultyLevel ?? parseCefrLevel(bestWord.difficulty);
        const confidence =
          typeof bestWord.difficultyConfidence === 'number'
            ? bestWord.difficultyConfidence
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
      cursor += bestLength;
      plainStart = cursor;
    }

    if (plainStart < currentText.length) {
      fragment.appendChild(document.createTextNode(currentText.slice(plainStart)));
    }

    return fragment;
  };
}

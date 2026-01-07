import type { WebEnhanceOutput } from '@lexipath/core';
import { getWordColor } from '../shared/word-colors';

export type WordRenderMode = 'target-to-native' | 'native-to-target';

/**
 * Create enhanced text fragment with word highlighting.
 * Must be deterministic and support repeated occurrences.
 */
export function createEnhancedElement(
  original: string,
  enhanced: WebEnhanceOutput,
  mode: WordRenderMode
): DocumentFragment {
  const fragment = document.createDocumentFragment();

  if (!enhanced.convert_word || enhanced.convert_word.length === 0) {
    fragment.appendChild(document.createTextNode(original));
    return fragment;
  }

  const currentText = original;
  const currentLower = currentText.toLowerCase();
  const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;

  const words = enhanced.convert_word
    .map((word) => ({
      ...word,
      originalLower: word.original.toLowerCase(),
      enforceWordBoundary: /[A-Za-z]/.test(word.original),
    }))
    .filter((word) => word.originalLower.trim().length > 0);

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

    const matchedOriginal = currentText.slice(cursor, cursor + bestLength);

    const span = document.createElement('span');
    span.className = 'lexipath-word';
    const color = getWordColor(bestWord.partOfSpeech, isDarkMode);
    span.style.cssText = `border-bottom: 2px dotted ${color}; cursor: pointer; position: relative;`;
    span.dataset.original = matchedOriginal;
    span.dataset.converted = bestWord.converted;
    span.dataset.difficulty = bestWord.difficulty || '';
    span.dataset.partOfSpeech = bestWord.partOfSpeech || '';
    span.dataset.renderMode = mode;

    const displayText =
      mode === 'native-to-target'
        ? `${bestWord.converted} (${matchedOriginal})`
        : matchedOriginal;
    const tooltipText = mode === 'native-to-target' ? matchedOriginal : bestWord.converted;
    span.textContent = displayText;
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

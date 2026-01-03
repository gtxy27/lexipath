import type { WebEnhanceOutput } from '@lexipath/core';

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

  const words = enhanced.convert_word
    .map((word) => ({
      ...word,
      originalLower: word.original.toLowerCase(),
      enforceWordBoundary: /[A-Za-z]/.test(word.original),
    }))
    .filter((word) => word.originalLower.trim().length > 0);

  const isWordChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);
  const hasWordBoundary = (start: number, length: number) => {
    const before = start > 0 ? (currentText[start - 1] ?? '') : '';
    const after = start + length < currentText.length ? (currentText[start + length] ?? '') : '';
    return !isWordChar(before) && !isWordChar(after);
  };

  let cursor = 0;
  while (cursor < currentText.length) {
    let bestIndex = -1;
    let bestLength = 0;
    let bestWord: (typeof words)[number] | null = null;

    for (const word of words) {
      const needle = word.originalLower;
      const length = needle.length;
      if (!length) continue;

      let idx = currentLower.indexOf(needle, cursor);
      while (idx !== -1 && word.enforceWordBoundary && !hasWordBoundary(idx, length)) {
        idx = currentLower.indexOf(needle, idx + 1);
      }
      if (idx === -1) continue;

      if (bestIndex === -1 || idx < bestIndex || (idx === bestIndex && length > bestLength)) {
        bestIndex = idx;
        bestLength = length;
        bestWord = word;
      }
    }

    if (!bestWord || bestIndex === -1 || bestLength <= 0) break;

    if (bestIndex > cursor) {
      fragment.appendChild(document.createTextNode(currentText.slice(cursor, bestIndex)));
    }

    const matchedOriginal = currentText.slice(bestIndex, bestIndex + bestLength);

    const span = document.createElement('span');
    span.className = 'lexipath-word';
    span.style.cssText = 'border-bottom: 2px dotted #3b82f6; cursor: pointer; position: relative;';
    span.dataset.original = matchedOriginal;
    span.dataset.converted = bestWord.converted;
    span.dataset.difficulty = bestWord.difficulty || '';
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
    cursor = bestIndex + bestLength;
  }

  if (cursor < currentText.length) {
    fragment.appendChild(document.createTextNode(currentText.slice(cursor)));
  }

  return fragment;
}

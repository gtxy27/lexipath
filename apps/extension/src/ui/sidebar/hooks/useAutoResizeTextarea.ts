import * as React from 'react';

export function useAutoResizeTextarea(options: {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  // Used by callers to trigger re-layout when UI changes (e.g. switching views).
  dependencies?: React.DependencyList;
  minHeightPx?: number;
  maxHeightPx?: number;
}): void {
  const minHeightPx = options.minHeightPx ?? 44;
  const maxHeightPx = options.maxHeightPx ?? 176;

  React.useLayoutEffect(() => {
    const el = options.textareaRef.current;
    if (!el) return;

    el.style.minHeight = `${minHeightPx}px`;
    el.style.height = 'auto';

    if (!options.value.trim()) {
      el.style.height = `${minHeightPx}px`;
      el.style.overflowY = 'hidden';
      return;
    }

    const nextHeight = Math.min(Math.max(el.scrollHeight, minHeightPx), maxHeightPx);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > maxHeightPx ? 'auto' : 'hidden';
  }, [options.textareaRef, options.value, minHeightPx, maxHeightPx, ...(options.dependencies ?? [])]);
}

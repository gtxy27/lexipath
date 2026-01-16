import * as React from 'react';

export function useScrollAtBottom(options: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  disabled?: boolean;
  thresholdPx?: number;
}): boolean {
  const thresholdPx = options.thresholdPx ?? 96;
  const [isAtBottom, setIsAtBottom] = React.useState(true);

  React.useEffect(() => {
    if (options.disabled) return;

    const viewport = options.viewportRef.current;
    if (!viewport) return;

    let rafId = 0;

    const update = () => {
      rafId = 0;
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      setIsAtBottom(distanceFromBottom <= thresholdPx);
    };

    const onScroll = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(update);
    };

    update();
    viewport.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      viewport.removeEventListener('scroll', onScroll);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [options.disabled, options.viewportRef, thresholdPx]);

  return isAtBottom;
}

import type { sendMessage } from "../../shared/messages";

export type ExposureTracker = Readonly<{
  registerExposure: (element: Element, normalizedWords: string[]) => void;
  reset: () => void;
  disconnect: () => void;
}>;

export function createExposureTracker(options: {
  sendMessage: typeof sendMessage;
  emitContext: (update: { seenCount: number }) => void;
  exposureSentWords: Set<string>;
}): ExposureTracker {
  let exposureObserver: IntersectionObserver | null = null;
  const exposureTargets = new WeakMap<Element, string[]>();
  const exposureTimers = new Map<Element, number>();

  const ensureExposureObserver = () => {
    if (exposureObserver) return;
    if (typeof IntersectionObserver === "undefined") return;

    exposureObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target;
          if (!(el instanceof Element)) continue;

          const existingTimer = exposureTimers.get(el);
          if (!entry.isIntersecting) {
            if (existingTimer) {
              clearTimeout(existingTimer);
              exposureTimers.delete(el);
            }
            continue;
          }

          if (existingTimer) continue;

           const timer = window.setTimeout(() => {
             exposureTimers.delete(el);
             const words = exposureTargets.get(el) ?? [];
             const toSend = words.filter((w) => !options.exposureSentWords.has(w));
             if (toSend.length === 0) {
               // No new words to report; stop tracking this element.
               try {
                 exposureObserver?.unobserve(el);
               } catch {
                 // Ignore.
               }
               return;
             }


             for (const w of toSend) options.exposureSentWords.add(w);
             options.emitContext({ seenCount: options.exposureSentWords.size });
             void options.sendMessage("RECORD_EXPOSURE_VALID", { words: toSend });

             // Reporting is per-element, one-shot; unobserve to avoid long-lived observer churn.
             try {
               exposureObserver?.unobserve(el);
             } catch {
               // Ignore.
             }
           }, 2000);

          exposureTimers.set(el, timer);
        }
      },
      { root: null, rootMargin: "0px", threshold: 0.35 }
    );
  };

  const registerExposure = (element: Element, normalizedWords: string[]) => {
    if (normalizedWords.length === 0) return;
    ensureExposureObserver();
    exposureTargets.set(element, normalizedWords);
    exposureObserver?.observe(element);
  };

  const reset = () => {
    for (const timer of exposureTimers.values()) {
      clearTimeout(timer);
    }
    exposureTimers.clear();
    options.exposureSentWords.clear();
  };

  const disconnect = () => {
    if (exposureObserver) {
      exposureObserver.disconnect();
      exposureObserver = null;
    }
    reset();
  };

  return Object.freeze({ registerExposure, reset, disconnect });
}

import { isEnhancePausedNow } from "../../shared/tab-state";
import { isCoarsePointer } from "../../shared/ui/overlay-adaptation";
import type { WebWordCardManager } from "./web-word-card";

export type WebTooltipManager = Readonly<{
  ensureMounted: () => void;
  hideTooltip: () => void;
  forceHideTooltipAndCard: () => void;
  destroy: () => void;
}>;

const HOVER_UPGRADE_DELAY_MS = 800;

export function createWebTooltipManager(options: {
  getWordCardManager: () => WebWordCardManager;
}): WebTooltipManager {
  let injected = false;
  let tooltipEl: HTMLDivElement | null = null;
  let tooltipTarget: HTMLElement | null = null;
  let hoverTimer: number | null = null;

  const handlers: Array<{
    target: Document | Window;
    type: string;
    handler: any;
    capture: boolean | undefined;
  }> = [];

  const hideTooltip = () => {
    if (!tooltipEl) return;
    tooltipTarget = null;
    tooltipEl.style.display = "none";
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  };

  const forceHideTooltipAndCard = () => {
    hideTooltip();
    try {
      options.getWordCardManager().hide();
    } catch (error: unknown) {
      void error;
    }
  };

  const positionTooltip = (clientX: number, clientY: number) => {
    if (!tooltipEl) return;

    const padding = 12;
    const offset = 14;

    tooltipEl.style.left = "0px";
    tooltipEl.style.top = "0px";

    const rect = tooltipEl.getBoundingClientRect();
    let x = clientX + offset;
    let y = clientY + offset;

    const maxX = window.innerWidth - rect.width - padding;
    const maxY = window.innerHeight - rect.height - padding;
    x = Math.max(padding, Math.min(x, maxX));
    y = Math.max(padding, Math.min(y, maxY));

    tooltipEl.style.left = `${Math.round(x)}px`;
    tooltipEl.style.top = `${Math.round(y)}px`;
  };

  const showTooltipForWord = (wordEl: HTMLElement, clientX: number, clientY: number) => {
    if (isEnhancePausedNow()) return;
    if (isCoarsePointer()) return;
    if (!tooltipEl || options.getWordCardManager().isVisible()) return;

    const tooltipText = wordEl.dataset.tooltip?.trim();
    if (!tooltipText) {
      hideTooltip();
      return;
    }

    tooltipTarget = wordEl;
    tooltipEl.textContent = tooltipText;
    tooltipEl.style.display = "block";
    positionTooltip(clientX, clientY);

    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      if (tooltipTarget !== wordEl) return;
      hideTooltip();
      const rect = wordEl.getBoundingClientRect();
      const word = wordEl.dataset.lookup || wordEl.dataset.original || wordEl.textContent || "";
      options.getWordCardManager().show(word, rect, { pinned: false });
    }, HOVER_UPGRADE_DELAY_MS);
  };

  const getWordEl = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const found = target.closest(".lexipath-word");
    return found instanceof HTMLElement ? found : null;
  };

  const ensureMounted = () => {
    if (injected) return;
    injected = true;

    tooltipEl = document.createElement("div");
    tooltipEl.id = "lexipath-tooltip";
    tooltipEl.style.display = "none";
    document.documentElement.appendChild(tooltipEl);

    const add = (target: Document | Window, type: string, handler: any, capture?: boolean) => {
      target.addEventListener(type, handler, capture);
      handlers.push({ target, type, handler, capture });
    };

    add(document, "pointerover", (event: PointerEvent) => {
      if (isEnhancePausedNow()) return;
      const wordEl = getWordEl(event.target);
      if (!wordEl) return;
      showTooltipForWord(wordEl, event.clientX, event.clientY);
    }, true);

    add(document, "pointermove", (event: PointerEvent) => {
      if (!tooltipEl || !tooltipTarget) return;
      positionTooltip(event.clientX, event.clientY);
    }, true);

    add(document, "pointerout", (event: PointerEvent) => {
      if (hoverTimer) {
        clearTimeout(hoverTimer);
        hoverTimer = null;
      }
      if (!tooltipTarget) return;
      const next = getWordEl((event as any).relatedTarget);
      if (next && next === tooltipTarget) return;
      hideTooltip();
    }, true);

    add(document, "click", (event: MouseEvent) => {
      if (isEnhancePausedNow()) return;
      const wordEl = getWordEl(event.target);
      if (!wordEl) return;

      event.preventDefault();
      event.stopPropagation();

      hideTooltip();
      const rect = wordEl.getBoundingClientRect();
      const word = wordEl.dataset.lookup || wordEl.dataset.original || wordEl.textContent || "";
      options.getWordCardManager().show(word, rect, { pinned: true });
    }, true);

    add(document, "focusin", (event: FocusEvent) => {
      if (isEnhancePausedNow()) return;
      const wordEl = getWordEl(event.target);
      if (!wordEl) return;
      const rect = wordEl.getBoundingClientRect();
      showTooltipForWord(wordEl, rect.left, rect.bottom);
    }, true);

    add(document, "focusout", hideTooltip, true);
    add(window, "scroll", hideTooltip, true);
    add(window, "blur", hideTooltip);
    add(window, "resize", hideTooltip);
  };

  const destroy = () => {
    for (const { target, type, handler, capture } of handlers) {
      try {
        target.removeEventListener(type, handler, capture);
      } catch (error: unknown) {
        void error;
      }
    }
    handlers.length = 0;

    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }

    tooltipTarget = null;

    if (tooltipEl && tooltipEl.parentNode) {
      tooltipEl.parentNode.removeChild(tooltipEl);
    }
    tooltipEl = null;
    injected = false;
  };

  return Object.freeze({
    ensureMounted,
    hideTooltip,
    forceHideTooltipAndCard,
    destroy,
  });
}

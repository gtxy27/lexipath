import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { t } from "./optionsI18n";

type TourStep = {
  id: "summary" | "learning" | "channels" | "general";
  tab: "summary" | "learning" | "channels" | "general";
  anchorId: string;
  titleKey: string;
  descKey: string;
};

function findVisibleAnchor(anchorId: string): HTMLElement | null {
  const elements = Array.from(
    document.querySelectorAll(`[data-tour-id=\"${anchorId}\"]`),
  );
  for (const el of elements) {
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return null;
}

function computeCardPosition(input: {
  highlight: { top: number; left: number; width: number; height: number } | null;
  cardWidth: number;
  cardHeight: number;
  gap: number;
}): { top: number; left: number } {
  const vw = Math.max(0, window.innerWidth);
  const vh = Math.max(0, window.innerHeight);

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(max, value));

  if (!input.highlight) {
    return {
      top: clamp(vh - input.cardHeight - 24, 16, vh - input.cardHeight - 16),
      left: clamp((vw - input.cardWidth) / 2, 16, vw - input.cardWidth - 16),
    };
  }

  const h = input.highlight;

  // Prefer placing the card below the highlight; fallback above; otherwise bottom.
  const belowTop = h.top + h.height + input.gap;
  const aboveTop = h.top - input.gap - input.cardHeight;

  const canBelow = belowTop + input.cardHeight <= vh - 16;
  const canAbove = aboveTop >= 16;

  const top = canBelow
    ? belowTop
    : canAbove
      ? aboveTop
      : vh - input.cardHeight - 24;

  const idealLeft = h.left + h.width / 2 - input.cardWidth / 2;
  const left = clamp(idealLeft, 16, vw - input.cardWidth - 16);

  return { top, left };
}

export function OptionsTour(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkSeen: () => Promise<void>;
  onNavigateTab: (tab: "summary" | "learning" | "channels" | "general") => void;
}): React.ReactElement | null {
  const { open, onOpenChange, onMarkSeen, onNavigateTab } = props;

  const steps: TourStep[] = useMemo(
    () => [
      {
        id: "summary",
        tab: "summary",
        anchorId: "options-tab-summary",
        titleKey: "optionsTab_summary",
        descKey: "optionsTourStep_summary_desc",
      },
      {
        id: "learning",
        tab: "learning",
        anchorId: "options-tab-learning",
        titleKey: "optionsTab_learning",
        descKey: "optionsTourStep_learning_desc",
      },
      {
        id: "channels",
        tab: "channels",
        anchorId: "options-tab-channels",
        titleKey: "optionsTab_channels",
        descKey: "optionsTourStep_channels_desc",
      },
      {
        id: "general",
        tab: "general",
        anchorId: "options-tab-general",
        titleKey: "optionsTab_general",
        descKey: "optionsTourStep_general_desc",
      },
    ],
    [],
  );

  const [stepIndex, setStepIndex] = useState<number>(0);
  const [highlight, setHighlight] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  const openRef = useRef(open);
  openRef.current = open;

  const step = steps[Math.max(0, Math.min(steps.length - 1, stepIndex))]!;

  useEffect(() => {
    if (!open) return;
    // Reset to the first step whenever the tour is opened.
    setStepIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    onNavigateTab(step.tab);
  }, [open, onNavigateTab, step.tab, stepIndex]);

  useEffect(() => {
    if (!open) return;

    let raf = 0;

    const update = () => {
      raf = 0;
      const el = findVisibleAnchor(step.anchorId);
      if (!el) {
        setHighlight(null);
        return;
      }

      const rect = el.getBoundingClientRect();

      // Only scroll when the anchor is outside the viewport; avoids jumpy behavior.
      try {
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
          el.scrollIntoView({ block: "center", inline: "center" });
        }
      } catch {
        // ignore
      }
      if (rect.width <= 0 || rect.height <= 0) {
        setHighlight(null);
        return;
      }

      const padding = 10;
      setHighlight({
        top: Math.max(8, rect.top - padding),
        left: Math.max(8, rect.left - padding),
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
      });
    };

    const schedule = () => {
      if (!openRef.current) return;
      if (raf) return;
      raf = requestAnimationFrame(update);
    };

    schedule();
    window.addEventListener("resize", schedule);
    // Capture scroll events from nested scroll containers.
    window.addEventListener("scroll", schedule, true);

    return () => {
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [open, step.anchorId]);

  if (!open) return null;

  const cardWidth = 360;
  const cardHeight = 170;
  const pos = computeCardPosition({
    highlight,
    cardWidth,
    cardHeight,
    gap: 14,
  });

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  async function handleSkipOrDone() {
    await onMarkSeen();
    onOpenChange(false);
  }

  return (
    <div className="fixed inset-0 z-[60]">
      {highlight ? (
        <div
          className="fixed rounded-xl transition-all duration-300"
          style={{
            top: highlight.top,
            left: highlight.left,
            width: highlight.width,
            height: highlight.height,
            boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.55)",
            border: "1px solid rgba(255, 255, 255, 0.16)",
            pointerEvents: "none",
          }}
        />
      ) : (
        <div className="fixed inset-0 bg-black/55" />
      )}

      <div
        className="fixed rounded-xl border border-border bg-background/95 backdrop-blur shadow-lg p-4 w-[360px] max-w-[calc(100vw-32px)] transition-all duration-300"
        style={{
          top: pos.top,
          left: pos.left,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">
              {stepIndex + 1}/{steps.length}
            </div>
            <div className="mt-1 text-base font-semibold tracking-tight truncate">
              {t(step.titleKey)}
            </div>
            <div className="mt-1 text-sm text-muted-foreground leading-relaxed">
              {t(step.descKey)}
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-3 rounded-lg"
            onClick={handleSkipOrDone}
          >
            {t("optionsTourSkip")}
          </Button>

          <div className="flex items-center gap-2">
            {!isFirst ? (
              <Button
                type="button"
                variant="outline"
                className="h-9 px-3 rounded-lg"
                onClick={() => setStepIndex((i: number) => Math.max(0, i - 1))}
              >
                {t("optionsTourBack")}
              </Button>
            ) : null}

            {isLast ? (
              <Button
                type="button"
                className="h-9 px-4 rounded-lg"
                onClick={handleSkipOrDone}
              >
                {t("optionsTourDone")}
              </Button>
            ) : (
              <Button
                type="button"
                className="h-9 px-4 rounded-lg"
                onClick={() => setStepIndex((i: number) => Math.min(steps.length - 1, i + 1))}
              >
                {t("optionsTourNext")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

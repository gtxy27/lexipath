import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { t } from "./optionsI18n";
import { clampOverlayPositionToViewport } from "../../shared/ui/overlay-adaptation";

export type TourStepId =
  | "summary"
  | "learning_tab"
  | "channels_tab"
  | "general_tab"
  | "general_ai_required"
  | "channels_api_key"
  | "learning_language"
  | "learning_context"
  | "learning_routing";

type TourTab = "summary" | "learning" | "channels" | "general";

type TourStep = {
  id: TourStepId;
  tab: TourTab;
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
  const marginPx = 16;
  const overlaySize = { width: input.cardWidth, height: input.cardHeight };
  const viewport = { width: vw, height: vh };

  if (!input.highlight) {
    return clampOverlayPositionToViewport({
      position: {
        top: vh - input.cardHeight - 24,
        left: (vw - input.cardWidth) / 2,
      },
      overlaySize,
      viewport,
      marginPx,
    });
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
  return clampOverlayPositionToViewport({
    position: { top, left: idealLeft },
    overlaySize,
    viewport,
    marginPx,
  });
}

export function OptionsTour(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMarkSeen: () => Promise<void>;
  onNavigateTab: (tab: TourTab) => void;
  stepId?: TourStepId;
  onStepIdChange?: (stepId: TourStepId) => void;
}): React.ReactElement | null {
  const { open, onOpenChange, onMarkSeen, onNavigateTab, stepId, onStepIdChange } = props;

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
        id: "learning_tab",
        tab: "learning",
        anchorId: "options-tab-learning",
        titleKey: "optionsTab_learning",
        descKey: "optionsTourStep_learning_desc",
      },
      {
        id: "channels_tab",
        tab: "channels",
        anchorId: "options-tab-channels",
        titleKey: "optionsTab_channels",
        descKey: "optionsTourStep_channels_desc",
      },
      {
        id: "general_tab",
        tab: "general",
        anchorId: "options-tab-general",
        titleKey: "optionsTab_general",
        descKey: "optionsTourStep_general_desc",
      },
      {
        id: "general_ai_required",
        tab: "general",
        anchorId: "general-ai-required-panel",
        titleKey: "optionsTab_general",
        descKey: "optionsTourStep_general_ai_required_desc",
      },
      {
        id: "channels_api_key",
        tab: "channels",
        anchorId: "channels-api-config",
        titleKey: "optionsTab_channels",
        descKey: "optionsTourStep_channels_api_key_desc",
      },
      {
        id: "learning_language",
        tab: "learning",
        anchorId: "learning-language",
        titleKey: "optionsTab_learning",
        descKey: "optionsTourStep_learning_language_desc",
      },
      {
        id: "learning_context",
        tab: "learning",
        anchorId: "learning-context",
        titleKey: "optionsTab_learning",
        descKey: "optionsTourStep_learning_context_desc",
      },
      {
        id: "learning_routing",
        tab: "learning",
        anchorId: "learning-routing",
        titleKey: "optionsTab_learning",
        descKey: "optionsTourStep_learning_routing_desc",
      },
    ],
    [],
  );

  const currentStepId: TourStepId = stepId ?? steps[0]!.id;
  const stepIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === currentStepId),
  );
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
    onNavigateTab(step.tab);
  }, [open, onNavigateTab, step.tab, stepIndex]);

  useEffect(() => {
    if (!open) return;

    let raf = 0;
    let tries = 0;

    const update = () => {
      raf = 0;
      const el = findVisibleAnchor(step.anchorId);
      if (!el) {
        tries += 1;
        // When switching tabs, the anchor may not exist for a frame or two.
        if (tries < 25) {
          raf = requestAnimationFrame(update);
          return;
        }
        setHighlight(null);
        return;
      }
      tries = 0;

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

  // For API key step, keep the card bottom-centered (unobtrusive), rather than anchored to the form.
  const highlightForLayout = step.id === "channels_api_key" ? null : highlight;
  const pos = computeCardPosition({
    highlight: highlightForLayout,
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

  const overlayEnabled = step.id !== "channels_api_key";


  const nextEnabled = step.id !== "channels_api_key" && step.id !== "general_ai_required";

  // CTA hint: render without its own hooks to keep hook order stable.
  const ctaEl = step.id === "general_ai_required" ? findVisibleAnchor("general-ai-required-cta") : null;
  const ctaRect = ctaEl ? ctaEl.getBoundingClientRect() : null;
  const ctaHintRect =
    step.id === "general_ai_required" && ctaRect && ctaRect.width > 0 && ctaRect.height > 0
      ? ctaRect
      : null;

  return (
    <div className="fixed inset-0 z-[60] pointer-events-none">
      {overlayEnabled ? (
        highlight ? (
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
        )
      ) : null}

      {step.id === "general_ai_required" && ctaHintRect ? (
        <div
          className="fixed pointer-events-none"
          style={{
            top: ctaHintRect.top + ctaHintRect.height / 2,
            left: ctaHintRect.left - 14,
            transform: "translate(-100%, -50%)",
          }}
        >
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
            <div className="rounded-full bg-background/95 border border-border shadow px-2.5 py-1 text-[11px] text-foreground">
              {t("optionsTourClickToConfigure")}
            </div>
          </div>
        </div>
      ) : null}


      <div
        className="fixed rounded-xl border border-border bg-background/95 backdrop-blur shadow-lg p-4 w-[360px] max-w-[calc(100vw-32px)] transition-all duration-300 pointer-events-auto"
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
                onClick={() => {
                  const next = Math.max(0, stepIndex - 1);
                  const nextId = steps[next]?.id;
                  if (nextId) onStepIdChange?.(nextId);
                }}
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
                 disabled={!nextEnabled}
                 onClick={() => {
                   const next = Math.min(steps.length - 1, stepIndex + 1);
                   const nextId = steps[next]?.id;
                   if (nextId) onStepIdChange?.(nextId);
                 }}
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

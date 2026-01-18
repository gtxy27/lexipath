import React, { useEffect, useRef, useState, useCallback } from "react";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { WordCard, type WordCardData } from "./WordCard";
import { sendMessage } from "../../shared/messages";
import { cn } from "../lib/utils";
import { t } from "../../shared/i18n";
import { computeAnchoredOverlayPosition, isCoarsePointer } from "../../shared/ui/overlay-adaptation";

import { motion, AnimatePresence } from "framer-motion";

export interface WordCardPopoverProps {
  word: string;
  anchorRect: DOMRect;
  mode?: "hover" | "click";
  onClose: () => void;
  onFavoriteToggle?: (word: string, isFavorited: boolean) => void;
  onLearnedToggle?: (word: string, isLearned: boolean) => void;
}

interface Position {
  top: number;
  left: number;
}

const log = createLogger("ui:WordCardPopover");

const useIsCoarsePointer = () => {
  const [isCoarse, setIsCoarse] = useState(false);
  useEffect(() => {
    const update = () => setIsCoarse(isCoarsePointer());
    update();

    const mql = window.matchMedia?.("(pointer: coarse)");
    mql?.addEventListener?.("change", update);
    return () => mql?.removeEventListener?.("change", update);
  }, []);
  return isCoarse;
};

function resolveTtsLang(options: {
  targetLanguage?: string;
  nativeLanguage?: string;
}): string {
  switch (options.targetLanguage) {
    case "en":
      return "en-US";
    case "ja":
      return "ja-JP";
    case "ko":
      return "ko-KR";
    case "fr":
      return "fr-FR";
    case "de":
      return "de-DE";
    case "zh":
      return options.nativeLanguage === "zh-TW" ? "zh-TW" : "zh-CN";
    default:
      return "en-US";
  }
}

export function WordCardPopover({
  word,
  anchorRect,
  mode = "click",
  onClose,
  onFavoriteToggle,
  onLearnedToggle,
}: WordCardPopoverProps): React.ReactElement {
  const [cardData, setCardData] = useState<WordCardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [ttsLang, setTtsLang] = useState<string>("en-US");
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const [isVisible, setIsVisible] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const response = await sendMessage("GET_SETTINGS", undefined);
        if (!response.ok || cancelled) return;
        setTtsLang(resolveTtsLang(response.value));
      } catch (error: unknown) {
        log.warn("Failed to load settings for TTS language; using default", { message: getErrorMessage(error) });
      }
    }

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch word explanation
  useEffect(() => {
    let cancelled = false;

    async function fetchWordData() {
      setIsLoading(true);
      try {
        const response = await sendMessage("EXPLAIN_WORD", { word });
        if (cancelled) return;

        if (response.ok) {
          const data = response.value as {
            word: string;
            phonetic?: string;
            definition: string;
            difficulty?: string;
          };
          setCardData({
            word: data.word || word,
            ...(data.phonetic ? { phonetic: data.phonetic } : {}),
            definition: data.definition || t("wordCard_definitionUnavailable"),
            ...(data.difficulty ? { difficulty: data.difficulty } : {}),
          });
        } else {
          log.error("Failed to fetch word data", response.error);
          setCardData({
            word,
            definition: t("wordCard_definitionFailed"),
          });
        }
      } catch (error) {
        if (cancelled) return;
        log.error("Error fetching word data", { message: getErrorMessage(error) });
        setCardData({
          word,
          definition: t("wordCard_definitionError"),
        });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchWordData();

    return () => {
      cancelled = true;
    };
  }, [word]);

  // Calculate position
  useEffect(() => {
    if (!popoverRef.current) return;

    const popoverRect = popoverRef.current.getBoundingClientRect();

    const MARGIN = 8;
    const OFFSET = 10;

    const { top, left } = computeAnchoredOverlayPosition({
      anchorRect,
      overlaySize: { width: popoverRect.width, height: popoverRect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      marginPx: MARGIN,
      offsetPx: OFFSET,
      prefer: "below",
    });

    setPosition({ top, left });

    // Trigger animation after position is calculated
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, [anchorRect, cardData]);

  // Handle click outside to close
  useEffect(() => {
    if (mode !== "click") return;

    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        onClose();
      }
    }

    // Add listener after a small delay to avoid immediate close
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [mode, onClose]);

  // Handle hover mode
  const handleMouseEnter = useCallback(() => {
    if (mode === "hover" && closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = undefined;
    }
  }, [mode]);

  const handleMouseLeave = useCallback(() => {
    if (mode === "hover") {
      closeTimeoutRef.current = setTimeout(() => {
        onClose();
      }, 300);
    }
  }, [mode, onClose]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const isMobile = useIsCoarsePointer();

  return (
    <AnimatePresence>
      <motion.div
        ref={popoverRef}
        initial={isMobile ? { y: "100%", opacity: 0 } : { opacity: 0 }}
        animate={isMobile ? { y: 0, opacity: 1 } : { opacity: 1 }}
        exit={isMobile ? { y: "100%", opacity: 0 } : { opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className={cn(
          "fixed z-[10000]",
          isMobile 
            ? "bottom-0 left-0 right-0 w-full" 
            : "rounded-lg shadow-xl"
        )}
        style={
          isMobile
            ? { bottom: 0, paddingBottom: "env(safe-area-inset-bottom, 0px)" }
            : {
                top: `${position.top}px`,
                left: `${position.left}px`,
              }
        }
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {isLoading ? (
          <div className={cn(
            "bg-popover text-popover-foreground border border-border p-4 min-w-[280px]",
            isMobile ? "rounded-t-2xl px-6 pb-12 pt-8" : "rounded-lg"
          )}>
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            </div>
          </div>
        ) : cardData ? (
          <div className={cn(
            "bg-popover text-popover-foreground overflow-hidden border border-border",
            isMobile ? "rounded-t-3xl border-t shadow-[0_-10px_40px_rgba(0,0,0,0.2)] px-2 pb-8 pt-4" : "rounded-lg border shadow-xl"
          )}>
            {isMobile && (
              <div className="w-12 h-1.5 bg-muted/60 rounded-full mx-auto mb-4" />
            )}
            <WordCard
              data={cardData}
              mode={isMobile ? "click" : mode}
              ttsLang={ttsLang}
              {...(onFavoriteToggle ? { onFavoriteToggle } : {})}
              {...(onLearnedToggle ? { onLearnedToggle } : {})}
              onClose={onClose}
            />
          </div>
        ) : null}
      </motion.div>
    </AnimatePresence>
  );
}

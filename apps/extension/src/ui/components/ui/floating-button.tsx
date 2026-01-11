import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Eye,
  EyeOff,
  Languages,
  PanelRightClose,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import browser from "webextension-polyfill";
import { Button } from "./button";

type EnhanceSiteMode = "manual" | "auto_blacklist" | "auto_whitelist";
type SiteRuleStatus = "enabled" | "disabled" | "not_in_whitelist";

interface FloatingButtonProps {
  onOpenSidebar?: () => void;
  onRunEnhanceOnce?: () => void | Promise<void>;
  onRunRewriteOnce?: () => void | Promise<void>;
  onToggleCurrentSiteRule?: () => void | Promise<void>;
  onSetTabShowOriginal?: (showOriginal: boolean) => void | Promise<void>;
  onSetTabEnhancePaused?: (paused: boolean) => void | Promise<void>;
  onOpenOptions?: () => void | Promise<void>;
  onHideOnce?: () => void | Promise<void>;
  enabled?: boolean;
  initialEnabled?: boolean;
  enhanceSiteMode?: EnhanceSiteMode;
  siteRuleStatus?: SiteRuleStatus;
  siteRuleMatchedRule?: string;
  currentHost?: string;
  tabShowOriginal?: boolean;
  enhancePaused?: boolean;
  hasEnhancedMarkup?: boolean;
  forgottenWords?: Array<{ word: string; familiarity: number; encounters: number }>;
  translatedCount?: number;
  seenCount?: number;
  webEnhanceMode?: "i_plus_1" | "light" | "full";
  pageEligible?: boolean;
  pageLanguage?: string;
}

export const FloatingButton: React.FC<FloatingButtonProps> = ({
  onOpenSidebar,
  onRunEnhanceOnce,
  onRunRewriteOnce,
  onToggleCurrentSiteRule,
  onSetTabShowOriginal,
  onSetTabEnhancePaused,
  onOpenOptions,
  onHideOnce,
  enabled: enabledProp,
  initialEnabled = true,
  enhanceSiteMode = "manual",
  siteRuleStatus = "enabled",
  siteRuleMatchedRule,
  currentHost,
  tabShowOriginal = false,
  enhancePaused = false,
  hasEnhancedMarkup = false,
  forgottenWords = [],
  translatedCount = 0,
  seenCount = 0,
  webEnhanceMode = "i_plus_1",
  pageEligible = true,
}) => {
  function t(key: string, substitutions?: string | string[]): string {
    try {
      const message = browser.i18n.getMessage(key, substitutions as any);
      return message || key;
    } catch (error: unknown) {
      void error;
      return key;
    }
  }

  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [forgottenOpen, setForgottenOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const enabled = enabledProp ?? initialEnabled;

  const DEFAULT_BUTTON_WIDTH = 110;
  const DEFAULT_BUTTON_HEIGHT = 48;
  const EDGE_MARGIN = 12;

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const snapToEdge = (pos: { x: number; y: number }, dims: { width: number; height: number }) => {
    const width = Math.max(1, Math.round(dims.width));
    const height = Math.max(1, Math.round(dims.height));

    const xMax = window.innerWidth - width - EDGE_MARGIN;
    const yMax = window.innerHeight - height - EDGE_MARGIN;
    const clampedY = clamp(pos.y, EDGE_MARGIN, Math.max(EDGE_MARGIN, yMax));

    const snapLeft = pos.x + width / 2 < window.innerWidth / 2;
    const snappedX = snapLeft ? EDGE_MARGIN : Math.max(EDGE_MARGIN, xMax);

    return { x: Math.round(snappedX), y: Math.round(clampedY) };
  };

  const persistPosition = (nextPos: { x: number; y: number }) => {
    setPosition(nextPos);
    void browser.storage.local.set({ floatingButtonPosition: nextPos });
  };

  // Load saved position
  useEffect(() => {
    browser.storage.local.get("floatingButtonPosition").then((res) => {
      const saved = res.floatingButtonPosition;
      const base =
        saved && typeof saved.x === "number" && typeof saved.y === "number"
          ? saved
          : { x: window.innerWidth - DEFAULT_BUTTON_WIDTH - EDGE_MARGIN, y: window.innerHeight - 150 };
      persistPosition(snapToEdge(base, { width: DEFAULT_BUTTON_WIDTH, height: DEFAULT_BUTTON_HEIGHT }));
    });
  }, []);

  useEffect(() => {
    function onResize() {
      setPosition((prev) => {
        const rect = buttonRef.current?.getBoundingClientRect();
        const nextPos = snapToEdge(prev, {
          width: rect?.width ?? DEFAULT_BUTTON_WIDTH,
          height: rect?.height ?? DEFAULT_BUTTON_HEIGHT,
        });
        void browser.storage.local.set({ floatingButtonPosition: nextPos });
        return nextPos;
      });
    }

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    function onPointerDown(event: PointerEvent) {
      const el = wrapperRef.current;
      if (!el) return;
      // In Shadow DOM, `event.target` is retargeted outside the shadow boundary.
      // Use `composedPath()` to reliably detect inside-clicks.
      const path = (event as Event).composedPath?.() ?? ([] as EventTarget[]);
      if (path.includes(el)) return;
      if (event.target instanceof Node && el.contains(event.target)) return;
      setIsOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  const handleDragEnd = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    const dims = {
      width: rect?.width ?? DEFAULT_BUTTON_WIDTH,
      height: rect?.height ?? DEFAULT_BUTTON_HEIGHT,
    };
    const current = rect ? { x: rect.left, y: rect.top } : position;
    persistPosition(snapToEdge(current, dims));
    requestAnimationFrame(() => setIsDragging(false));
  };

  const runAction = (action?: () => void | Promise<void>) => {
    if (!action) return;
    try {
      const result = action();
      if (result && typeof (result as any).then === "function") {
        (result as Promise<void>).catch((error: unknown) => {
          console.warn("Floating button action failed", error);
        });
      }
    } catch (error: unknown) {
      console.warn("Floating button action threw", error);
    }
  };

  const forgottenCount = forgottenWords.length;
  const showCancelEnhance = hasEnhancedMarkup && !enhancePaused;
  const buttonWidth = buttonRef.current?.getBoundingClientRect().width ?? DEFAULT_BUTTON_WIDTH;
  const isOnLeft = position.x + buttonWidth / 2 < window.innerWidth / 2;
  const showEnhanceItem = pageEligible || !onRunRewriteOnce;
  const displayCount = webEnhanceMode === "light" ? translatedCount : seenCount;
  const isEnhanceActive = enabled && pageEligible && !enhancePaused;

  const menuItems = [
    ...(pageEligible || !onRunRewriteOnce
      ? []
      : [
          {
            key: "rewrite",
            icon: Languages,
            label: t("floatingCommandCenterRewritePage"),
            hint: t("floatingCommandCenterRewritePageDesc"),
            color: "text-primary",
            onClick: () => {
              runAction(() => onSetTabEnhancePaused?.(false));
              runAction(() => onSetTabShowOriginal?.(false));
              runAction(onRunRewriteOnce);
              setIsOpen(false);
            },
          },
        ]),
    ...(showEnhanceItem
      ? [
          {
            key: "enhance",
            icon: Sparkles,
            label: showCancelEnhance
              ? t("floatingCommandCenterCancelEnhance")
              : t("floatingCommandCenterEnhanceOnce"),
            hint: showCancelEnhance
              ? t("floatingCommandCenterCancelEnhanceDesc")
              : t("floatingCommandCenterEnhanceOnceDesc"),
            color: "text-primary",
            onClick: () => {
              if (showCancelEnhance) {
                runAction(() => onSetTabEnhancePaused?.(true));
                runAction(() => onSetTabShowOriginal?.(true));
                setIsOpen(false);
                return;
              }

              runAction(() => onSetTabEnhancePaused?.(false));
              runAction(() => onSetTabShowOriginal?.(false));
              if (!hasEnhancedMarkup) runAction(onRunEnhanceOnce);
              setIsOpen(false);
            },
          },
        ]
      : []),
    ...(enhanceSiteMode === "auto_blacklist" || enhanceSiteMode === "auto_whitelist"
      ? [
          {
            key: "siteRule",
            icon: ShieldIconForSiteRule(siteRuleStatus),
            label: buildSiteRuleLabel({
              t,
              enhanceSiteMode,
              siteRuleStatus,
              ...(siteRuleMatchedRule ? { siteRuleMatchedRule } : {}),
              ...(currentHost ? { currentHost } : {}),
            }),
            hint: t("floatingCommandCenterToggleSiteRuleDesc"),
            color: siteRuleStatus === "enabled" ? "text-emerald-500" : "text-rose-500",
            onClick: () => {
              runAction(onToggleCurrentSiteRule);
              setIsOpen(false);
            },
          },
        ]
      : []),
    {
      key: "forgotten",
      icon: BookOpen,
      label: `${t("floatingCommandCenterForgotten")} (${forgottenCount})`,
      hint: t("floatingCommandCenterForgottenDesc"),
      color: forgottenCount > 0 ? "text-destructive" : "text-muted-foreground",
      onClick: () => {
        setForgottenOpen(true);
        setIsOpen(false);
      },
    },
    {
      key: "chat",
      icon: PanelRightClose,
      label: t("chatTitle"),
      hint: t("chatPageTitle"),
      color: "text-primary",
      onClick: () => {
        onOpenSidebar?.();
        setIsOpen(false);
      },
    },
    {
      key: "settings",
      icon: Settings2,
      label: t("openSettings"),
      hint: t("floatingCommandCenterOpenSettingsDesc"),
      color: "text-primary",
      onClick: () => {
        runAction(onOpenOptions);
        setIsOpen(false);
      },
    },
    {
      key: "hide",
      icon: EyeOff,
      label: t("floatingCommandCenterHide"),
      hint: t("floatingCommandCenterHideDesc"),
      color: "text-muted-foreground",
      onClick: () => {
        runAction(onHideOnce);
        setIsOpen(false);
      },
    },
  ];

  const itemByKey = new Map(menuItems.map((item) => [item.key, item]));
  const pageItems = [
    itemByKey.get("rewrite"),
    itemByKey.get("enhance"),
    itemByKey.get("siteRule"),
  ].filter(Boolean) as typeof menuItems;
  const focusItems = [itemByKey.get("forgotten"), itemByKey.get("chat")].filter(Boolean) as typeof menuItems;
  const settingsItems = [itemByKey.get("settings"), itemByKey.get("hide")].filter(Boolean) as typeof menuItems;

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
      onDragStart={() => {
        setIsDragging(true);
        setIsOpen(false);
      }}
      onDragEnd={handleDragEnd}
      initial={false}
      animate={{ x: position.x, y: position.y }}
      transition={{ type: "spring", stiffness: 520, damping: 38 }}
      className="fixed pointer-events-auto z-[2147483647]"
      style={{ touchAction: "none" }}
    >
      <div ref={wrapperRef} className="relative flex flex-col items-center">
	        {/* Menu Items */}
	        <AnimatePresence>
	          {isOpen && (
	            <motion.div
	              initial={{ opacity: 0, scale: 0.98, y: 10 }}
	              animate={{ opacity: 1, scale: 1, y: -10 }}
	              exit={{ opacity: 0, scale: 0.98, y: 10 }}
	              className={cn(
	                "absolute bottom-full mb-4",
	                isOnLeft ? "left-0" : "right-0",
	              )}
	            >
	              <div
	                className={cn(
	                  "relative overflow-hidden",
	                  "w-[340px] max-w-[calc(100vw-24px)]",
	                  "rounded-xl border border-border bg-popover shadow-lg",
	                  "p-3",
	                )}
	              >
	                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 dark:from-primary/5 via-transparent to-transparent opacity-70 dark:opacity-50" />
	                <div className="relative">
	                <div className="flex items-start justify-between gap-3 px-1 pb-2">
	                  <div className="min-w-0">
	                    <div className="text-[13px] font-semibold tracking-tight">
	                      {t("floatingCommandCenterTitle")}
	                    </div>
	                    {currentHost ? (
	                      <div className="text-[11px] text-muted-foreground truncate">
	                        {currentHost}
	                      </div>
	                    ) : null}
	                  </div>
	                  <Button
	                    type="button"
	                    size="icon"
	                    variant="ghost"
	                    className="h-8 w-8 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/40"
	                    onClick={() => setIsOpen(false)}
	                  >
	                    <X className="h-4 w-4" />
	                  </Button>
	                </div>

		                <div className="max-h-[360px] overflow-auto pr-1 space-y-3">
		                  {(
		                    [
		                      { key: "page", title: t("floatingCommandCenterSection_page"), items: pageItems },
		                      {
		                        key: "focus",
		                        title: t("floatingCommandCenterSection_focus"),
		                        items: focusItems,
		                      },
		                      {
		                        key: "settings",
		                        title: t("floatingCommandCenterSection_settings"),
		                        items: settingsItems,
		                      },
		                    ] as const
		                  )
		                    .filter((section) => section.items.length > 0)
		                    .map((section, sectionIndex) => (
		                      <div
		                        key={section.key}
		                        className={cn(
		                          "rounded-lg border border-border bg-muted/20",
		                          "p-3",
		                        )}
		                      >
		                        <div className="px-1 pb-2">
		                          <div className="text-[11px] text-muted-foreground/90 uppercase tracking-wide">
		                            {section.title}
		                          </div>
		                        </div>
		                        <div className="flex flex-col gap-2">
		                          {section.items.map((item, index) => {
		                            const isPrimary =
		                              section.key === "page" &&
		                              ((item.key === "rewrite" && !pageEligible) ||
		                                (item.key === "enhance" && !enhancePaused && pageEligible));
		                            const delay = sectionIndex * 0.03 + index * 0.03;
		                            return (
		                              <motion.button
		                                key={item.key}
		                                type="button"
		                                initial={{ opacity: 0, x: isOnLeft ? -10 : 10 }}
		                                animate={{ opacity: 1, x: 0 }}
		                                transition={{ delay }}
		                                onClick={item.onClick}
		                                onPointerDown={(event) => {
		                                  event.stopPropagation();
		                                }}
		                                className={cn(
		                                  "w-full text-left transition-colors",
		                                  "rounded-xl border border-border shadow-sm",
		                                  isPrimary
		                                    ? "bg-primary text-primary-foreground hover:bg-primary/90 border-primary/50"
		                                    : "bg-card hover:bg-muted/30 dark:hover:bg-muted/60",
		                                  isPrimary ? "px-4 py-3" : "px-3 py-2.5",
		                                )}
		                              >
		                                <div className="flex items-start gap-3">
		                                  <div
		                                    className={cn(
		                                      "mt-0.5 flex items-center justify-center rounded-xl border",
		                                      isPrimary
		                                        ? "h-10 w-10 bg-primary-foreground/10 border-primary-foreground/20 text-primary-foreground"
		                                        : "h-8 w-8 bg-card border-border shadow-sm",
		                                      !isPrimary && item.color,
		                                    )}
		                                  >
		                                    <item.icon className={cn(isPrimary ? "h-5 w-5" : "h-4 w-4")} />
		                                  </div>
		                                  <div className="min-w-0 flex-1">
		                                    <div
		                                      className={cn(
		                                        "truncate font-medium",
		                                        isPrimary
		                                          ? "text-[13px] text-primary-foreground"
		                                          : "text-[13px] text-foreground",
		                                      )}
		                                    >
		                                      {item.label}
		                                    </div>
		                                    <div
		                                      className={cn(
		                                        "leading-snug max-h-10 overflow-hidden",
		                                        isPrimary
		                                          ? "text-[11px] text-primary-foreground/80"
		                                          : "text-[11px] text-muted-foreground",
		                                      )}
		                                    >
		                                      {item.hint}
		                                    </div>
		                                  </div>
		                                </div>
		                              </motion.button>
		                            );
		                          })}
		                        </div>
		                      </div>
		                    ))}
		                </div>
	                </div>
	              </div>
	            </motion.div>
	          )}
	        </AnimatePresence>

        {/* Forgotten drawer */}
        <AnimatePresence>
          {forgottenOpen && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              className={cn(
                "fixed z-[2147483647] pointer-events-auto",
                "bg-popover border border-border shadow-lg",
                "rounded-xl",
                "w-[320px] max-w-[calc(100vw-24px)]",
                "p-4 overflow-hidden relative",
                "right-3 bottom-20",
              )}
            >
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 dark:from-primary/5 via-transparent to-transparent opacity-70 dark:opacity-50" />
              <div className="relative">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[13px] font-semibold tracking-tight">
                  {t("floatingCommandCenterForgotten")}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-xl hover:bg-muted/40"
                  onClick={() => setForgottenOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {forgottenWords.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">
                  {t("floatingCommandCenterForgottenEmpty")}
                </div>
              ) : (
                <div className="max-h-[260px] overflow-auto pr-1">
                  <div className="flex flex-col gap-2">
                    {forgottenWords.map((item) => (
                      <div
                        key={item.word}
                        className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium truncate">
                            {item.word}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {t("floatingCommandCenterForgottenMeta", [
                              String(item.familiarity),
                              String(item.encounters),
                            ])}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Toggle Button */}
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <Button
            ref={buttonRef}
            variant="ghost"
            type="button"
            aria-label={isOpen ? t("floatingCommandCenterClose") : t("floatingCommandCenterOpen")}
            onClick={() => {
              if (isDragging) return;
              setIsOpen((prev) => !prev);
            }}
            className={cn(
              "relative h-12 rounded-full shadow-md transition-colors border",
              "px-3.5",
              isEnhanceActive
                ? "bg-primary border-primary/50 text-primary-foreground hover:bg-primary/90"
                : "bg-card border-border text-foreground hover:bg-muted/40 dark:hover:bg-muted/70",
            )}
          >
            {isOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <div className="flex items-center gap-2">
                <Languages className="h-5 w-5" />
                <span className="text-[13px] font-semibold tabular-nums">{displayCount}</span>
              </div>
            )}

            {/* Status indicator */}
            {!isOpen && (
              <span
                className={cn(
                  "absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full border-2 border-background",
                  isEnhanceActive ? "bg-emerald-500" : "bg-rose-500",
                )}
              />
            )}
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
};

function ShieldIconForSiteRule(status: SiteRuleStatus) {
  return status === "disabled" ? EyeOff : Eye;
}

function buildSiteRuleLabel(options: {
  t: (key: string, substitutions?: string | string[]) => string;
  enhanceSiteMode: EnhanceSiteMode;
  siteRuleStatus: SiteRuleStatus;
  siteRuleMatchedRule?: string;
  currentHost?: string;
}): string {
  const { t, enhanceSiteMode, siteRuleStatus } = options;

  if (enhanceSiteMode === "auto_blacklist") {
    if (siteRuleStatus === "disabled") {
      return t("floatingCommandCenterEnableThisSite");
    }
    return t("floatingCommandCenterDisableThisSite");
  }

  if (enhanceSiteMode === "auto_whitelist") {
    if (siteRuleStatus === "enabled") {
      return t("floatingCommandCenterRemoveThisSite");
    }
    return t("floatingCommandCenterAllowThisSite");
  }

  return t("floatingCommandCenterCurrentSite", "");
}

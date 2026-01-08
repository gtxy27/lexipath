import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Eye,
  EyeOff,
  Globe,
  Languages,
  PanelRightClose,
  Power,
  Repeat,
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
  onToggleEnabled?: (enabled: boolean) => void;
  onOpenSidebar?: () => void;
  onRunEnhanceOnce?: () => void | Promise<void>;
  onCycleWebEnhanceMode?: () => void | Promise<void>;
  onCycleEnhanceSiteMode?: () => void | Promise<void>;
  onToggleCurrentSiteRule?: () => void | Promise<void>;
  onToggleOriginalTab?: () => void | Promise<void>;
  onToggleOriginalGlobal?: () => void | Promise<void>;
  onOpenOptions?: () => void | Promise<void>;
  onHideOnce?: () => void | Promise<void>;
  onHideFloatingButton?: () => void | Promise<void>;
  enabled?: boolean;
  initialEnabled?: boolean;
  webEnhanceMode?: "light" | "i_plus_1" | "full";
  enhanceSiteMode?: EnhanceSiteMode;
  siteRuleStatus?: SiteRuleStatus;
  siteRuleMatchedRule?: string;
  currentHost?: string;
  globalShowOriginal?: boolean;
  forgottenWords?: Array<{ word: string; familiarity: number; encounters: number }>;
}

export const FloatingButton: React.FC<FloatingButtonProps> = ({
  onToggleEnabled,
  onOpenSidebar,
  onRunEnhanceOnce,
  onCycleWebEnhanceMode,
  onCycleEnhanceSiteMode,
  onToggleCurrentSiteRule,
  onToggleOriginalTab,
  onToggleOriginalGlobal,
  onOpenOptions,
  onHideOnce,
  onHideFloatingButton,
  enabled: enabledProp,
  initialEnabled = true,
  webEnhanceMode = "i_plus_1",
  enhanceSiteMode = "manual",
  siteRuleStatus = "enabled",
  siteRuleMatchedRule,
  currentHost,
  globalShowOriginal = false,
  forgottenWords = [],
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
  const [enabled, setEnabled] = useState(enabledProp ?? initialEnabled);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [forgottenOpen, setForgottenOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof enabledProp !== "boolean") return;
    setEnabled(enabledProp);
  }, [enabledProp]);

  // Load saved position
  useEffect(() => {
    browser.storage.local.get("floatingButtonPosition").then((res) => {
      if (res.floatingButtonPosition) {
        setPosition(res.floatingButtonPosition);
      } else {
        // Default position: bottom right
        setPosition({ x: window.innerWidth - 80, y: window.innerHeight - 150 });
      }
    });
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

  const savePosition = (_event: unknown, info: { point: { x: number; y: number } }) => {
    const margin = 12;
    const clampedX = Math.min(Math.max(info.point.x, margin), window.innerWidth - 56 - margin);
    const clampedY = Math.min(Math.max(info.point.y, margin), window.innerHeight - 56 - margin);
    const newPos = { x: clampedX, y: clampedY };
    setPosition(newPos);
    browser.storage.local.set({ floatingButtonPosition: newPos });
  };

  const handleDragEnd = (event: unknown, info: { point: { x: number; y: number } }) => {
    savePosition(event, info);
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

  const webEnhanceModeLabel = (() => {
    switch (webEnhanceMode) {
      case "light":
        return t("optionsWebEnhanceModeLight");
      case "full":
        return t("optionsWebEnhanceModeFull");
      default:
        return t("optionsWebEnhanceModeIPlus1");
    }
  })();

  const enhanceSiteModeLabel = (() => {
    switch (enhanceSiteMode) {
      case "auto_blacklist":
        return t("optionsEnhanceModeAutoBlacklist");
      case "auto_whitelist":
        return t("optionsEnhanceModeAutoWhitelist");
      default:
        return t("optionsEnhanceModeManual");
    }
  })();

  const forgottenCount = forgottenWords.length;

  const menuItems = [
    {
      icon: Power,
      label: `${t("enabled")}: ${enabled ? t("on") : t("off")}`,
      hint: t("optionsEnabledHint"),
      color: enabled ? "text-emerald-500" : "text-rose-500",
      onClick: () => {
        const next = !enabled;
        setEnabled(next);
        onToggleEnabled?.(next);
      },
    },
    {
      icon: Sparkles,
      label: t("floatingCommandCenterEnhanceOnce"),
      hint: t("floatingCommandCenterEnhanceOnceDesc"),
      color: "text-indigo-500",
      onClick: () => {
        runAction(onRunEnhanceOnce);
        setIsOpen(false);
      },
    },
    {
      icon: Repeat,
      label: `${t("optionsWebEnhanceModeLabel")}: ${webEnhanceModeLabel}`,
      hint: t("floatingCommandCenterCycleEnhanceModeDesc"),
      color: "text-indigo-500",
      onClick: () => {
        runAction(onCycleWebEnhanceMode);
      },
    },
    {
      icon: Globe,
      label: `${t("optionsEnhanceModeLabel")}: ${enhanceSiteModeLabel}`,
      hint: t("floatingCommandCenterCycleSiteModeDesc"),
      color: "text-sky-500",
      onClick: () => {
        runAction(onCycleEnhanceSiteMode);
      },
    },
    ...(enhanceSiteMode === "auto_blacklist" || enhanceSiteMode === "auto_whitelist"
      ? [
          {
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
            },
          },
        ]
      : []),
    {
      icon: Eye,
      label: t("floatingCommandCenterToggleOriginalTab"),
      hint: t("floatingCommandCenterToggleOriginalTabDesc"),
      color: "text-gray-700 dark:text-gray-200",
      onClick: () => {
        runAction(onToggleOriginalTab);
      },
    },
    {
      icon: Eye,
      label: t(
        "floatingCommandCenterToggleOriginalGlobal",
        globalShowOriginal ? t("on") : t("off"),
      ),
      hint: t("floatingCommandCenterToggleOriginalGlobalDesc"),
      color: "text-gray-700 dark:text-gray-200",
      onClick: () => {
        runAction(onToggleOriginalGlobal);
      },
    },
    {
      icon: BookOpen,
      label: `${t("floatingCommandCenterForgotten")} (${forgottenCount})`,
      hint: t("floatingCommandCenterForgottenDesc"),
      color: forgottenCount > 0 ? "text-rose-500" : "text-gray-500",
      onClick: () => {
        setForgottenOpen(true);
      },
    },
    {
      icon: PanelRightClose,
      label: t("chatTitle"),
      hint: t("chatPageTitle"),
      color: "text-indigo-500",
      onClick: () => {
        onOpenSidebar?.();
        setIsOpen(false);
      },
    },
    {
      icon: Settings2,
      label: t("openSettings"),
      hint: t("floatingCommandCenterOpenSettingsDesc"),
      color: "text-indigo-500",
      onClick: () => {
        runAction(onOpenOptions);
        setIsOpen(false);
      },
    },
    {
      icon: EyeOff,
      label: t("floatingCommandCenterHideOnce"),
      hint: t("floatingCommandCenterHideOnceDesc"),
      color: "text-gray-500",
      onClick: () => {
        runAction(onHideOnce);
        setIsOpen(false);
      },
    },
    {
      icon: EyeOff,
      label: t("floatingCommandCenterHide"),
      hint: t("floatingCommandCenterHideDesc"),
      color: "text-gray-500",
      onClick: () => {
        runAction(onHideFloatingButton);
        setIsOpen(false);
      },
    },
  ];

  return (
    <motion.div
      drag={!isOpen}
      dragMomentum={false}
      dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={handleDragEnd}
      initial={false}
      animate={{ x: position.x, y: position.y }}
      className="fixed pointer-events-auto z-[2147483647]"
      style={{ touchAction: "none" }}
    >
      <div ref={wrapperRef} className="relative flex flex-col items-center">
        {/* Menu Items */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: -10 }}
              exit={{ opacity: 0, scale: 0.5, y: 20 }}
              className="absolute bottom-full mb-4 flex flex-col gap-3 items-center"
            >
              {menuItems.map((item, index) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Button
                    type="button"
                    variant="outline"
                    onClick={item.onClick}
                    className="h-10 rounded-full px-4 py-2 shadow-xl backdrop-blur-xl bg-white/90 dark:bg-[#1a1b23]/90 border-gray-200/80 dark:border-white/10 hover:bg-white dark:hover:bg-[#1a1b23] hover:scale-[1.03] transition-transform"
                  >
                    <item.icon className={cn("h-4 w-4", item.color)} />
                    <span className="text-xs font-bold text-gray-800 dark:text-gray-100 whitespace-nowrap">
                      {item.label}
                    </span>
                    <span className="sr-only">{item.hint}</span>
                  </Button>
                </motion.div>
              ))}
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
              className={cn(
                "fixed z-[2147483647] pointer-events-auto",
                "bg-white/95 dark:bg-[#0d0e14]/95 border border-gray-200/80 dark:border-white/10 shadow-2xl backdrop-blur-xl",
                "rounded-2xl",
                "w-[320px] max-w-[calc(100vw-24px)]",
                "p-4",
                "right-3 bottom-20",
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-black text-gray-900 dark:text-white">
                  {t("floatingCommandCenterForgotten")}
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 rounded-xl"
                  onClick={() => setForgottenOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {forgottenWords.length === 0 ? (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t("floatingCommandCenterForgottenEmpty")}
                </div>
              ) : (
                <div className="max-h-[260px] overflow-auto pr-1">
                  <div className="flex flex-col gap-2">
                    {forgottenWords.map((item) => (
                      <div
                        key={item.word}
                        className="flex items-center justify-between rounded-xl border border-gray-200/70 dark:border-white/10 bg-white/80 dark:bg-white/5 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-extrabold text-gray-900 dark:text-white truncate">
                            {item.word}
                          </div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400">
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Toggle Button */}
        <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
          <Button
            type="button"
            size="icon"
            aria-label={isOpen ? t("floatingCommandCenterClose") : t("floatingCommandCenterOpen")}
            onClick={() => {
              if (isDragging) return;
              setIsOpen((prev) => !prev);
            }}
          className={cn(
              "relative h-14 w-14 rounded-full shadow-2xl backdrop-blur-xl transition-colors border",
            enabled 
              ? "bg-indigo-600/90 border-indigo-500 text-white" 
              : "bg-gray-200/90 dark:bg-gray-800/90 border-gray-300 dark:border-gray-700 text-gray-500"
          )}
          >
            {isOpen ? <X className="h-6 w-6" /> : <Languages className="h-6 w-6" />}

            {/* Status indicator */}
            {!isOpen && (
              <span
                className={cn(
                  "absolute top-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-[#0d0e14]",
                  enabled ? "bg-emerald-500" : "bg-rose-500"
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
  const { t, enhanceSiteMode, siteRuleStatus, siteRuleMatchedRule, currentHost } = options;
  const host = currentHost?.trim() ? currentHost.trim() : t("floatingCommandCenterCurrentSite");

  if (enhanceSiteMode === "auto_blacklist") {
    if (siteRuleStatus === "disabled") {
      return t("floatingCommandCenterEnableThisSite", host);
    }
    return t("floatingCommandCenterDisableThisSite", host);
  }

  if (enhanceSiteMode === "auto_whitelist") {
    if (siteRuleStatus === "enabled") {
      return t("floatingCommandCenterRemoveThisSite", siteRuleMatchedRule ?? host);
    }
    return t("floatingCommandCenterAllowThisSite", host);
  }

  return t("floatingCommandCenterCurrentSite", host);
}

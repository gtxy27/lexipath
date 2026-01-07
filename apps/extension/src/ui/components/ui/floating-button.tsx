import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Languages, PanelRightClose, Power, X } from "lucide-react";
import { cn } from "../../lib/utils";
import browser from "webextension-polyfill";
import { Button } from "./button";

interface FloatingButtonProps {
  onToggleEnabled?: (enabled: boolean) => void;
  onOpenSidebar?: () => void;
  initialEnabled?: boolean;
}

export const FloatingButton: React.FC<FloatingButtonProps> = ({
  onToggleEnabled,
  onOpenSidebar,
  initialEnabled = true
}) => {
  function t(key: string): string {
    try {
      return browser.i18n.getMessage(key) || key;
    } catch {
      return key;
    }
  }

  const [isOpen, setIsOpen] = useState(false);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

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
      icon: PanelRightClose,
      label: t("chatTitle"),
      hint: t("chatPageTitle"),
      color: "text-indigo-500",
      onClick: () => {
        onOpenSidebar?.();
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

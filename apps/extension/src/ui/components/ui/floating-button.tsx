import React, { useState, useEffect } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { 
  Languages, 
  Settings, 
  Zap, 
  PanelRightClose, 
  Menu,
  X,
  Power,
  Info
} from "lucide-react";
import { cn } from "../../lib/utils";
import browser from "webextension-polyfill";

interface FloatingButtonProps {
  onToggleEnabled?: (enabled: boolean) => void;
  onOpenSettings?: () => void;
  onOpenSidebar?: () => void;
  initialEnabled?: boolean;
}

export const FloatingButton: React.FC<FloatingButtonProps> = ({
  onToggleEnabled,
  onOpenSettings,
  onOpenSidebar,
  initialEnabled = true
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragControls = useDragControls();

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

  const savePosition = (event: any, info: any) => {
    const newPos = { x: info.point.x, y: info.point.y };
    setPosition(newPos);
    browser.storage.local.set({ floatingButtonPosition: newPos });
  };

  const menuItems = [
    { 
      icon: Power, 
      label: enabled ? "Enabled" : "Disabled", 
      color: enabled ? "text-emerald-500" : "text-rose-500",
      onClick: () => {
        const next = !enabled;
        setEnabled(next);
        onToggleEnabled?.(next);
      }
    },
    { 
      icon: PanelRightClose, 
      label: "Sidebar", 
      color: "text-indigo-500",
      onClick: () => {
        onOpenSidebar?.();
        setIsOpen(false);
      }
    },
    { 
      icon: Settings, 
      label: "Settings", 
      color: "text-gray-500",
      onClick: () => {
        onOpenSettings?.();
        setIsOpen(false);
      }
    },
  ];

  return (
    <div className="fixed inset-0 pointer-events-none z-[9999]">
      <motion.div
        drag
        dragMomentum={false}
        dragTransition={{ bounceStiffness: 600, bounceDamping: 20 }}
        onDragEnd={savePosition}
        initial={false}
        animate={{ x: position.x, y: position.y }}
        className="absolute pointer-events-auto"
        style={{ touchAction: "none" }}
      >
        <div className="relative flex flex-col items-center">
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
                  <motion.button
                    key={item.label}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={item.onClick}
                    className="flex items-center gap-2 bg-white dark:bg-[#1a1b23] border border-gray-200 dark:border-white/10 rounded-full px-4 py-2 shadow-xl hover:scale-105 transition-transform"
                  >
                    <item.icon className={cn("h-4 w-4", item.color)} />
                    <span className="text-xs font-bold text-gray-700 dark:text-gray-200 whitespace-nowrap">
                      {item.label}
                    </span>
                  </motion.button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Main Toggle Button */}
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setIsOpen(!isOpen)}
            className={cn(
              "h-14 w-14 rounded-full flex items-center justify-center shadow-2xl backdrop-blur-xl transition-colors border",
              enabled 
                ? "bg-indigo-600/90 border-indigo-500 text-white" 
                : "bg-gray-200/90 dark:bg-gray-800/90 border-gray-300 dark:border-gray-700 text-gray-500"
            )}
          >
            {isOpen ? <X className="h-6 w-6" /> : <Languages className="h-6 w-6" />}
            
            {/* Status indicator */}
            {!isOpen && (
              <div className={cn(
                "absolute top-0 right-0 h-4 w-4 rounded-full border-2 border-white dark:border-[#0d0e14]",
                enabled ? "bg-emerald-500" : "bg-rose-500"
              )} />
            )}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
};

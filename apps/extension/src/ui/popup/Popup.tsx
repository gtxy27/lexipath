import React, { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import type { Settings } from "@lexipath/core";
import { createLogger } from "@lexipath/core/log";
import { sendMessage } from "../../shared/messages";
import { motion, AnimatePresence } from "framer-motion";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useApplyTheme } from "../lib/theme";
import { ICON_URL } from "../lib/assets";
import {
  Loader2,
  Settings2,
  Power,
  Languages,
  GraduationCap,
  ChevronRight,
  Zap,
  Moon,
  Sun,
  Monitor,
} from "lucide-react";

const log = createLogger("ui:Popup");

function t(key: string, substitutions?: string | string[]): string {
  const message = browser.i18n.getMessage(key, substitutions as any);
  return message || key;
}

export function Popup(): React.ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  useApplyTheme(settings?.theme);

  useEffect(() => {
    async function loadSettings() {
      const response = await sendMessage("GET_SETTINGS", undefined);
      if (response.ok) {
        setSettings(response.value);
      } else {
        log.error("Failed to get settings", response.error);
      }
      setLoading(false);
    }
    loadSettings();
  }, []);

  async function toggleEnabled() {
    if (!settings) return;
    const nextEnabled = !settings.enabled;
    const response = await sendMessage("SET_SETTINGS", {
      enabled: nextEnabled,
    });
    if (response.ok) {
      setSettings({ ...settings, enabled: nextEnabled });
    } else {
      log.error("Failed to update settings", response.error);
    }
  }

  async function toggleTheme() {
    if (!settings) return;
    const currentTheme = settings.theme ?? "system";
    const nextTheme =
      currentTheme === "system" ? "light" : currentTheme === "light" ? "dark" : "system";

    const response = await sendMessage("SET_SETTINGS", { theme: nextTheme });
    if (response.ok) {
      setSettings({ ...settings, theme: nextTheme });
    } else {
      log.error("Failed to update theme", response.error);
    }
  }

  if (loading) {
    return (
      <div className="flex h-72 w-[340px] items-center justify-center bg-white dark:bg-[#0d0e14]">
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.5, 1, 0.5],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <div className="h-12 w-12 rounded-2xl bg-gradient-premium p-[1px]">
             <div className="flex h-full w-full items-center justify-center rounded-[15px] bg-white dark:bg-[#0d0e14]">
                <img src={ICON_URL} className="h-6 w-6" alt={t("extensionName")} />
             </div>
          </div>
        </motion.div>
      </div>
    );
  }

  const isEnabled = !!settings?.enabled;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
  const currentTheme = settings?.theme ?? "system";
  const isDark = currentTheme === "dark" || (currentTheme === "system" && prefersDark);
  const themeLabel =
    currentTheme === "system"
      ? t("themeSystem")
      : currentTheme === "dark"
        ? t("themeDark")
        : t("themeLight");
  const themeButtonLabel = t("toggleTheme", themeLabel);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-[340px] overflow-hidden bg-white dark:bg-[#0d0e14]"
    >
      <div className={`relative transition-all duration-500 ${isEnabled ? 'bg-indigo-50/10 dark:bg-indigo-500/[0.02]' : ''}`}>
        {/* Decorative Background Elements */}
        <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-indigo-600/[0.03] dark:bg-indigo-600/10 blur-[60px] pointer-events-none" />
        <div className="absolute -left-20 -bottom-20 h-40 w-40 rounded-full bg-purple-600/[0.03] dark:bg-purple-600/10 blur-[60px] pointer-events-none" />

        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader className="pb-4 pt-6 px-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-premium p-[1px] shadow-lg shadow-indigo-500/10">
                  <div className="flex h-full w-full items-center justify-center rounded-[11px] bg-white dark:bg-[#0d0e14]">
                    <img
                      src={ICON_URL}
                      className="h-6 w-6"
                      alt={t("extensionName")}
                    />
                  </div>
                </div>
                <div>
                  <CardTitle className="text-xl font-black tracking-tight text-gray-900 dark:text-white">
                    {t("extensionName")}
                  </CardTitle>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className={`h-1.5 w-1.5 rounded-full ${isEnabled ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)] animate-pulse' : 'bg-gray-300 dark:bg-gray-600'}`} />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                      {isEnabled ? t("on") : t("off")}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-10 w-10 rounded-xl bg-white/60 dark:bg-white/[0.03] hover:bg-gray-100 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200"
                  onClick={toggleTheme}
                  aria-label={themeButtonLabel}
                  title={themeButtonLabel}
                >
                  {currentTheme === "system" ? (
                    <Monitor className="h-4 w-4" />
                  ) : currentTheme === "dark" ? (
                    <Moon className="h-4 w-4" />
                  ) : (
                    <Sun className="h-4 w-4" />
                  )}
                </Button>
                <Switch
                  checked={isEnabled}
                  onCheckedChange={toggleEnabled}
                  className="data-[state=checked]:bg-indigo-600"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 px-6 pb-6">
            {/* Main Status Display */}
            <div className="relative group">
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition duration-500 blur-sm" />
              <div className="relative bg-gray-50/50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/5 rounded-2xl p-4 flex items-center justify-between transition-all">
                <div className="flex items-center gap-3.5">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${isEnabled ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'bg-gray-100 dark:bg-white/5 text-gray-400'}`}>
                    <Zap className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400/70">
                      {t("popupStatusLabel")}
                    </div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">
                      {t("popupModeSmartLearning")}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50/50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/5 rounded-2xl p-3.5 transition-all hover:bg-gray-100/50 dark:hover:bg-white/5">
                <div className="mb-2.5 flex items-center gap-2">
                  <Languages className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    {t("targetLanguage")}
                  </span>
                </div>
                <div className="text-sm font-bold text-gray-900 dark:text-white truncate">
                  {settings?.targetLanguage
                    ? t(`languageTarget_${settings.targetLanguage}`)
                    : t("popupValueUnset")}
                </div>
              </div>

              <div className="bg-gray-50/50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/5 rounded-2xl p-3.5 transition-all hover:bg-gray-100/50 dark:hover:bg-white/5">
                <div className="mb-2.5 flex items-center gap-2">
                  <GraduationCap className="h-3.5 w-3.5 text-purple-500 dark:text-purple-400" />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400">
                    {t("proficiencyLevel")}
                  </span>
                </div>
                <div className="text-sm font-bold text-gray-900 dark:text-white truncate">
                  {settings?.proficiencyLevel
                    ? t(`proficiency_${settings.proficiencyLevel}`)
                    : t("popupValueUnset")}
                </div>
              </div>
            </div>
          </CardContent>

          <CardFooter className="px-6 pb-6 pt-0">
            <Button
              variant="outline"
              className="w-full h-11 justify-between bg-white dark:bg-white/[0.03] hover:bg-gray-50 dark:hover:bg-white/5 border-gray-200 dark:border-white/10 text-gray-900 dark:text-white transition-all group rounded-xl px-4"
              onClick={() => browser.runtime.openOptionsPage()}
            >
              <div className="flex items-center gap-2.5">
                <Settings2 className="h-4 w-4 text-indigo-500 dark:text-indigo-400 group-hover:rotate-90 transition-transform duration-500" />
                <span className="font-bold text-sm tracking-tight">{t("openSettings")}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400 group-hover:translate-x-0.5 transition-transform" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    </motion.div>
  );
}

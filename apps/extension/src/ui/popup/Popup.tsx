import React, { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import type { Settings } from "@lexipath/core";
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
import {
  Loader2,
  Settings2,
  Power,
  Languages,
  GraduationCap,
  ChevronRight,
  Zap,
} from "lucide-react";

function t(key: string): string {
  return browser.i18n.getMessage(key) || key;
}

export function Popup(): React.ReactElement {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      const response = await sendMessage("GET_SETTINGS", undefined);
      if (response.ok) {
        setSettings(response.value);
      } else {
        console.error("[LexiPath] Failed to get settings:", response.error);
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
      console.error("[LexiPath] Failed to update settings:", response.error);
    }
  }

  if (loading) {
    return (
      <div className="flex h-72 w-[340px] items-center justify-center bg-[#0d0e14]">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, 180, 360],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <Loader2 className="h-10 w-10 text-indigo-500" />
        </motion.div>
      </div>
    );
  }

  const isEnabled = !!settings?.enabled;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-[340px] overflow-hidden rounded-xl bg-white dark:bg-[#0d0e14] p-0.5"
    >
      <div className={`relative overflow-hidden rounded-[11px] bg-white dark:bg-[#0d0e14] transition-all duration-500 ${isEnabled ? 'shadow-[0_0_20px_rgba(99,102,241,0.15)] dark:shadow-[0_0_20px_rgba(99,102,241,0.2)]' : ''}`}>
        {/* Decorative Background Elements */}
        <div className="absolute -right-20 -top-20 h-40 w-40 rounded-full bg-indigo-600/5 dark:bg-indigo-600/10 blur-[60px] pointer-events-none" />
        <div className="absolute -left-20 -bottom-20 h-40 w-40 rounded-full bg-purple-600/5 dark:bg-purple-600/10 blur-[60px] pointer-events-none" />

        <Card className="border-0 bg-transparent shadow-none">
          <CardHeader className="pb-4 pt-5 px-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <motion.div 
                  whileHover={{ rotate: 15, scale: 1.1 }}
                  className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-premium p-[1px]"
                >
                  <div className="flex h-full w-full items-center justify-center rounded-[11px] bg-white dark:bg-[#0d0e14]">
                    <img
                      src="../../icons/icon.svg"
                      className="h-6 w-6"
                      alt={t("extensionName")}
                    />
                  </div>
                </motion.div>
                <div>
                  <CardTitle className="text-xl font-black tracking-tight text-gray-900 dark:text-white">
                    {t("extensionName")}
                  </CardTitle>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className={`h-1.5 w-1.5 rounded-full ${isEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                      {isEnabled ? t("on") : t("off")}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={isEnabled}
                  onCheckedChange={toggleEnabled}
                  className="data-[state=checked]:bg-indigo-600"
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4 px-5 pb-5">
            {/* Main Status Display */}
            <div className="relative group">
              <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-indigo-500/10 to-purple-500/10 blur opacity-75 group-hover:opacity-100 transition duration-300 pointer-events-none" />
              <div className="relative glass-card bg-white/80 dark:bg-white/5 rounded-xl p-4 flex items-center justify-between shadow-sm border border-gray-100 dark:border-white/5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20">
                    <Zap className={`h-5 w-5 ${isEnabled ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-indigo-500 dark:text-indigo-400/70">
                      {t("popupStatusLabel")}
                    </div>
                    <div className="text-sm font-bold text-gray-900 dark:text-white">
                      {t("popupModeSmartLearning")}
                    </div>
                  </div>
                </div>
                <Badge className={`${isEnabled ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-500/30' : 'bg-gray-100 dark:bg-gray-500/10 text-gray-500 border-gray-200 dark:border-gray-500/20'} border shadow-none font-bold`}>
                   {isEnabled ? t("on") : t("off")}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <motion.div 
                whileHover={{ y: -2 }}
                className="glass-card bg-white/80 dark:bg-white/5 rounded-xl p-3 border border-gray-100 dark:border-white/5 shadow-sm"
              >
                <div className="mb-2 flex items-center gap-2">
                  <div className="p-1 rounded-md bg-blue-50 dark:bg-blue-500/10">
                    <Languages className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {t("targetLanguage")}
                  </span>
                </div>
                <div className="text-base font-black text-gray-900 dark:text-white tracking-wide">
                  {settings?.targetLanguage
                    ? t(`languageTarget_${settings.targetLanguage}`)
                    : t("popupValueUnset")}
                </div>
              </motion.div>

              <motion.div 
                whileHover={{ y: -2 }}
                className="glass-card bg-white/80 dark:bg-white/5 rounded-xl p-3 border border-gray-100 dark:border-white/5 shadow-sm"
              >
                <div className="mb-2 flex items-center gap-2">
                  <div className="p-1 rounded-md bg-purple-50 dark:bg-purple-500/10">
                    <GraduationCap className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                    {t("proficiencyLevel")}
                  </span>
                </div>
                <div className="text-base font-black text-gray-900 dark:text-white tracking-wide">
                  {settings?.proficiencyLevel
                    ? t(`proficiency_${settings.proficiencyLevel}`)
                    : t("popupValueUnset")}
                </div>
              </motion.div>
            </div>
          </CardContent>

          <CardFooter className="px-5 pb-5 pt-0">
            <Button
              variant="outline"
              className="w-full h-11 justify-between bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 border-gray-200 dark:border-white/10 hover:border-gray-300 dark:hover:border-white/20 text-gray-900 dark:text-white transition-all group rounded-xl"
              onClick={() => browser.runtime.openOptionsPage()}
            >
              <div className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400 group-hover:rotate-90 transition-transform duration-500" />
                <span className="font-bold tracking-wide">{t("openSettings")}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400 group-hover:translate-x-1 transition-transform" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    </motion.div>
  );
}

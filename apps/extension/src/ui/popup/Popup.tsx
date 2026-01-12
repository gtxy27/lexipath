import React, { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import type { Settings } from "@lexipath/core";
import { createLogger } from "@lexipath/core/log";
import { sendMessage } from "../../shared/messages";
import { t } from "../../shared/i18n";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Switch } from "../components/ui/switch";
import { Button } from "../components/ui/button";
import { useApplyTheme } from "../lib/theme";
import { ICON_URL } from "../lib/assets";
import {
  Loader2,
  Settings2,
  Languages,
  GraduationCap,
  ChevronRight,
  Zap,
  Sparkles,
  Moon,
  Sun,
  Monitor,
} from "lucide-react";

const log = createLogger("ui:Popup");

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

  async function toggleFloatingButton() {
    if (!settings) return;
    const nextFloatingEnabled = !(settings.floatingButtonEnabled ?? true);
    const response = await sendMessage("SET_SETTINGS", {
      floatingButtonEnabled: nextFloatingEnabled,
    });
    if (response.ok) {
      setSettings({ ...settings, floatingButtonEnabled: nextFloatingEnabled });
    } else {
      log.error("Failed to update floating button setting", response.error);
    }
  }

  if (loading) {
    return (
      <div className="flex h-72 w-[340px] flex-col items-center justify-center gap-3 bg-background text-foreground">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-card">
          <img src={ICON_URL} className="h-6 w-6" alt={t("extensionName")} />
        </div>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isEnabled = !!settings?.enabled;
  const currentTheme = settings?.theme ?? "system";
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
      className="w-[340px] overflow-hidden bg-background text-foreground"
    >
      <Card className="rounded-none border-0 shadow-none">
        <CardHeader className="relative flex-row items-center justify-between gap-3 border-b border-border px-5 py-4 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 dark:from-primary/5 via-transparent to-transparent opacity-70 dark:opacity-50" />
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-card">
              <img src={ICON_URL} className="h-5 w-5" alt={t("extensionName")} />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold leading-5 relative">
                {t("extensionName")}
              </CardTitle>
              <div className="mt-1 inline-flex items-center gap-2 rounded-full border bg-background/70 dark:bg-card/60 px-2.5 py-1 text-xs text-muted-foreground shadow-sm relative">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isEnabled ? "bg-emerald-500" : "bg-muted-foreground/40"
                  }`}
                />
                <span className="truncate">{isEnabled ? t("on") : t("off")}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 relative">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-9 w-9 rounded-lg hover:bg-muted/40"
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
              className="data-[state=checked]:bg-primary"
            />
          </div>
        </CardHeader>

        <CardContent className="space-y-3 px-5 py-4">
          <div className="relative flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 dark:from-primary/5 via-transparent to-transparent opacity-60 dark:opacity-45" />
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-md ${
                isEnabled
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Zap className="h-5 w-5" />
            </div>
            <div className="min-w-0 relative">
              <div className="text-xs text-muted-foreground">{t("popupStatusLabel")}</div>
              <div className="truncate text-sm font-medium">
                {t("popupModeSmartLearning")}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border bg-card p-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Languages className="h-4 w-4 text-primary" />
                <span className="truncate">{t("targetLanguage")}</span>
              </div>
              <div className="mt-2 truncate text-sm font-medium">
                {settings?.targetLanguage
                  ? t(`languageTarget_${settings.targetLanguage}`)
                  : t("popupValueUnset")}
              </div>
            </div>

            <div className="rounded-xl border bg-card p-3 shadow-sm">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <GraduationCap className="h-4 w-4 text-primary" />
                <span className="truncate">{t("proficiencyLevel")}</span>
              </div>
              <div className="mt-2 truncate text-sm font-medium">
                {settings?.proficiencyLevel
                  ? t(`proficiency_${settings.proficiencyLevel}`)
                  : t("popupValueUnset")}
              </div>
            </div>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-xl border bg-card p-3 shadow-sm">
            <div className="min-w-0">
              <div className="text-xs font-medium">{t("popupFloatingButtonLabel")}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t("popupFloatingButtonDesc")}
              </div>
            </div>
            <Switch
              checked={settings?.floatingButtonEnabled ?? true}
              onCheckedChange={toggleFloatingButton}
              className="data-[state=checked]:bg-primary"
            />
          </div>
        </CardContent>

        <CardFooter className="flex-col gap-2 px-5 pb-5 pt-0">
          <Button
            variant="outline"
            className="h-10 w-full justify-between rounded-xl px-3 bg-background dark:bg-card hover:bg-muted/40 dark:hover:bg-muted/60 shadow-sm"
            onClick={() => browser.runtime.openOptionsPage()}
          >
            <span className="flex items-center gap-2 text-sm font-medium">
              <Settings2 className="h-4 w-4 text-primary" />
              {t("openSettings")}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </Button>

          {!settings?.hasCompletedOnboarding ? (
            <Button
              variant="outline"
              className="h-10 w-full justify-between rounded-xl px-3 bg-background dark:bg-card hover:bg-muted/40 dark:hover:bg-muted/60 shadow-sm"
              onClick={() => {
                const url = browser.runtime.getURL("src/ui/onboarding/index.html");
                globalThis.open?.(url, "_blank");
              }}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                {t("openOnboarding")}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Button>
          ) : null}
        </CardFooter>
      </Card>
    </motion.div>
  );
}

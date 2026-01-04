import React, { useEffect, useState } from "react";
import browser from "webextension-polyfill";
import type { Settings } from "@lexipath/core";
import { sendMessage } from "../../shared/messages";
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
import { Separator } from "../components/ui/separator";
import {
  Loader2,
  Settings2,
  Power,
  Languages,
  GraduationCap,
} from "lucide-react";

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
      <div className="flex h-64 w-80 items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <Card className="w-80 border-0 shadow-lg overflow-hidden">
      <CardHeader className="pb-3 pt-4 bg-white border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-indigo-600">
              <img
                src="../../icons/icon.svg"
                className="h-5 w-5"
                alt="LexiPath"
              />
            </div>
            <CardTitle className="text-lg font-bold text-gray-900">
              LexiPath
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={!!settings?.enabled}
              onCheckedChange={toggleEnabled}
              id="extension-toggle"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 py-4 px-4">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-medium text-gray-600">
              <div className="p-1 rounded-md bg-indigo-100">
                <Power className="h-3.5 w-3.5 text-indigo-600" />
              </div>
              {browser.i18n.getMessage("status")}
            </span>
            <Badge
              className={
                settings?.enabled
                  ? "bg-emerald-500 text-white border-0"
                  : "bg-gray-200 text-gray-600 border-gray-300"
              }
            >
              {settings?.enabled
                ? browser.i18n.getMessage("on")
                : browser.i18n.getMessage("off")}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-gray-200 bg-white p-3 hover:border-gray-300 transition-colors">
            <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-500">
              <div className="p-0.5 rounded bg-blue-100">
                <Languages className="h-3 w-3 text-blue-600" />
              </div>
              {browser.i18n.getMessage("targetLanguage")}
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {settings?.targetLanguage || "-"}
            </div>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-3 hover:border-gray-300 transition-colors">
            <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-500">
              <div className="p-0.5 rounded bg-purple-100">
                <GraduationCap className="h-3 w-3 text-purple-600" />
              </div>
              {browser.i18n.getMessage("proficiencyLevel")}
            </div>
            <div className="text-sm font-semibold text-gray-900">
              {settings?.proficiencyLevel || "-"}
            </div>
          </div>
        </div>
      </CardContent>

      <CardFooter className="flex flex-col gap-2 pb-4 pt-2 px-4 bg-gray-50 border-t">
        <Separator className="mb-2 bg-gray-200" />
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 hover:bg-gray-200 transition-colors"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          <Settings2 className="h-4 w-4 text-gray-600" />
          <span className="text-gray-700">
            {browser.i18n.getMessage("openSettings")}
          </span>
        </Button>
      </CardFooter>
    </Card>
  );
}

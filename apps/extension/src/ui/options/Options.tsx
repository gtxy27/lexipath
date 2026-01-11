import React, { useEffect, useState } from "react";
import { SettingsSchema, type Settings } from "@lexipath/core";
import { createLogger } from "@lexipath/core/log";
import { sendMessage } from "../../shared/messages";
import { Button } from "../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Toaster } from "../components/ui/toaster";
import { useToast } from "../components/ui/use-toast";
import { Loader2 } from "lucide-react";
import {
  BarChart3,
  Languages,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useApplyTheme } from "../lib/theme";
import { ICON_URL } from "../lib/assets";
import { BackupTab } from "./tabs/BackupTab";
import { ChannelsTab } from "./tabs/ChannelsTab";
import { GeneralTab } from "./tabs/GeneralTab";
import { LearningTab } from "./tabs/LearningTab";
import { SummaryTab } from "./tabs/SummaryTab";
import {
  buildSettingsPatch,
  channelIsConfigured,
  requestIconHostPermissions,
  settingsToFormState,
} from "./optionsLogic";
import { t } from "./optionsI18n";
import type { FieldErrors, FormState } from "./optionsTypes";

const log = createLogger("ui:Options");

export function Options(): React.ReactElement {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("summary");

  useApplyTheme(form?.theme ?? settings?.theme);

  async function reloadSettings() {
    const response = await sendMessage("GET_SETTINGS", undefined);
    if (!response.ok) return;
    setSettings(response.value);
    setForm(settingsToFormState(response.value));
  }

  useEffect(() => {
    async function load() {
      const response = await sendMessage("GET_SETTINGS", undefined);
      if (!response.ok) {
        log.error("Failed to load settings", response.error);
        setLoading(false);
        return;
      }

      setSettings(response.value);
      setForm(settingsToFormState(response.value));
      setLoading(false);
    }
    load();
  }, []);

  async function handleSave() {
    if (!form || saving) return;

    setSaving(true);
    setErrors({});
    try {
      const built = buildSettingsPatch(form);
      if (!built.ok) {
        setErrors(built.errors);
        toast({
          title: t("optionsValidationError"),
          variant: "destructive",
        });
        return;
      }

      if (built.iconOriginsToRequest.length > 0) {
        await requestIconHostPermissions(built.iconOriginsToRequest);
      }

      const response = await sendMessage("SET_SETTINGS", built.patch);
      if (!response.ok) {
        toast({
          title: t("optionsSaveError", response.error.message),
          variant: "destructive",
        });
        return;
      }

      const merged = SettingsSchema.parse({
        ...(settings ?? {}),
        ...built.patch,
      });
      setSettings(merged);
      setForm(settingsToFormState(merged));
      toast({
        title: t("optionsSaveSuccess"),
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !form) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const currentForm = form;
  const setFormState: React.Dispatch<React.SetStateAction<FormState>> = (value) =>
    setForm((prev) => {
      const base = prev ?? currentForm;
      return typeof value === "function"
        ? (value as (prevState: FormState) => FormState)(base)
        : value;
    });

  const hasAiConfigured = currentForm.channels.some(channelIsConfigured);
  const openChannelsTab = () => setActiveTab("channels");

  return (
    <div className="min-h-screen bg-background text-foreground relative font-sans">
      <Toaster />

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="mx-auto max-w-[1440px] min-h-screen flex flex-col lg:flex-row"
      >
        <div className="w-full lg:w-72 lg:h-screen lg:sticky lg:top-0 border-b lg:border-b-0 lg:border-r border-border bg-card p-4 md:p-6 lg:p-8 flex flex-col gap-6 lg:gap-8">
          <div className="flex items-center gap-3 px-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border bg-background">
              <img src={ICON_URL} className="h-5 w-5" alt={t("extensionName")} />
            </div>
            <h1 className="text-base font-semibold tracking-tight truncate">
              {t("extensionName")}
            </h1>
          </div>

	          <TabsList className="hidden lg:flex flex-col h-auto bg-transparent border-0 space-y-1.5 p-0">
	            {[
	              { value: "summary", label: t("optionsTab_summary"), icon: BarChart3 },
	              { value: "learning", label: t("optionsTab_learning"), icon: Languages },
	              { value: "channels", label: t("optionsTab_channels"), icon: Sparkles },
	              { value: "general", label: t("optionsTab_general"), icon: SlidersHorizontal },
	            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="w-full justify-start gap-2.5 px-3 py-2.5 rounded-lg border border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                <tab.icon className="h-4 w-4 shrink-0" />
                <span className="font-medium whitespace-nowrap">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="hidden lg:flex mt-auto pt-6 border-t border-border flex-col gap-4">
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "h-2 w-2 rounded-full",
                    form.enabled
                      ? "bg-emerald-500"
                      : "bg-muted-foreground/40",
                  )}
                />
                <span className="text-xs text-muted-foreground">
                  {form.enabled ? t("on") : t("off")}
                </span>
              </div>
              <Button
                size="sm"
                className="h-9 px-4 text-xs font-medium rounded-lg"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
                {t("optionsSaveButton")}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col p-5 md:p-8 lg:p-12 xl:p-16 pb-32 lg:pb-16 max-w-5xl mx-auto w-full overflow-y-auto h-screen custom-scrollbar">
          <div className="lg:hidden flex justify-between items-center mb-6">
            <div className="flex items-center gap-3">
              <img src={ICON_URL} className="h-6 w-6" alt={t("extensionName")} />
              <h1 className="text-base font-semibold tracking-tight">{t("extensionName")}</h1>
            </div>
            <Button
              size="sm"
              className="rounded-lg px-5 h-10"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {t("optionsSaveButton")}
            </Button>
          </div>

	          <TabsContent
	            value="summary"
	            className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-400 outline-none"
	          >
	            <SummaryTab />
	          </TabsContent>

	          <TabsContent
	            value="learning"
	            className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-400 outline-none"
	          >
	            <LearningTab
	              form={currentForm}
	              setForm={setFormState}
	              errors={errors}
	              aiEnabled={hasAiConfigured}
	              onOpenChannels={openChannelsTab}
	            />
	          </TabsContent>

	          <TabsContent
	            value="channels"
	            className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-400 outline-none"
	          >
	            <ChannelsTab form={currentForm} setForm={setFormState} errors={errors} />
	          </TabsContent>

	          <TabsContent
	            value="general"
	            className="mt-0 space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-400 outline-none"
	          >
	            <GeneralTab
	              form={currentForm}
	              setForm={setFormState}
	              errors={errors}
	              aiEnabled={hasAiConfigured}
	              onOpenChannels={openChannelsTab}
	              onReloadSettings={reloadSettings}
	            />
	          </TabsContent>
	        </div>

	        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-background border-t border-border px-2 pb-safe pt-2 z-50">
	          <TabsList className="flex h-auto bg-transparent border-0 p-0">
	            {[
	              { value: "summary", label: t("optionsTab_summary"), icon: BarChart3 },
	              { value: "learning", label: t("optionsTab_learning"), icon: Languages },
	              { value: "channels", label: t("optionsTab_channels"), icon: Sparkles },
	              { value: "general", label: t("optionsTab_general"), icon: SlidersHorizontal },
	            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex-1 flex-col gap-1 py-3 rounded-lg data-[state=active]:bg-muted data-[state=active]:text-foreground text-muted-foreground border-0 shadow-none"
              >
                <tab.icon className="h-5 w-5" />
                <span className="text-[10px] font-medium">{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      <style
        dangerouslySetInnerHTML={{
          __html: `
          .custom-scrollbar::-webkit-scrollbar { width: 6px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.05); border-radius: 10px; }
          .dark .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.05); }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(0, 0, 0, 0.1); }
          .dark .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.1); }
          .no-scrollbar::-webkit-scrollbar { display: none; }
          .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

          details > summary [data-disclosure-chevron] { transition: transform 150ms ease-out; }
          details[open] > summary [data-disclosure-chevron] { transform: rotate(90deg); }

          .lx-style-preview .lx-preview-word {
            cursor: default;
            display: inline-flex;
            align-items: center;
            border-radius: 4px;
            padding: 0 6px;
            border-bottom: 2px dotted var(--lx-word-color, #6366f1);
            background: rgba(99, 102, 241, 0.12);
            color: inherit;
          }
          .lx-style-preview [data-lx-style="border"] {
            border-bottom-style: dotted;
          }
          .lx-style-preview [data-lx-style="dashedLine"] {
            border-bottom-style: dashed;
            background: rgba(99, 102, 241, 0.10);
          }
          .lx-style-preview [data-lx-style="weakened"] {
            opacity: 0.85;
            background: rgba(244, 63, 94, 0.10);
          }
          .lx-style-preview [data-lx-style="background"] {
            background: rgba(34, 197, 94, 0.10);
          }
          .lx-style-preview [data-lx-style="textColor"] {
            background: rgba(148, 163, 184, 0.12);
          }
        `,
        }}
      />
    </div>
  );
}

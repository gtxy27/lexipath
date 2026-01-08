import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { AiGate } from "../AiGate";
import { dedupeStrings, normalizeSiteEntry } from "../optionsLogic";
import { t } from "../optionsI18n";
import type { FormState } from "../optionsTypes";

export function SitesTab(props: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  aiEnabled: boolean;
  onOpenChannels: () => void;
  embedded?: boolean;
}): React.ReactElement {
  const { form, setForm, aiEnabled, onOpenChannels, embedded = false } = props;

  const body = (
    <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-8 shadow-sm">
      {(() => {
        type EnhanceSiteMode = "manual" | "auto_blacklist" | "auto_whitelist";
        const enhanceSiteMode: EnhanceSiteMode = form.autoEnhance
          ? form.siteMode === "whitelist"
            ? "auto_whitelist"
            : "auto_blacklist"
          : "manual";

        return (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-5">
                <div className="space-y-1">
                  <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
                    {t("optionsEnhanceModeLabel")}
                  </h4>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                    {t("optionsEnhanceModeDesc")}
                  </p>
                </div>
                <Select
                  value={enhanceSiteMode}
                  onValueChange={(v) => {
                    const next = v as EnhanceSiteMode;
                    if (next === "manual") {
                      setForm({ ...form, autoEnhance: false });
                      return;
                    }
                    if (next === "auto_whitelist") {
                      setForm({
                        ...form,
                        autoEnhance: true,
                        siteMode: "whitelist",
                      });
                      return;
                    }
                    setForm({ ...form, autoEnhance: true, siteMode: "all" });
                  }}
                >
                  <SelectTrigger className="w-full sm:w-52 bg-white/70 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-10 font-bold text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                    <SelectItem value="manual">{t("optionsEnhanceModeManual")}</SelectItem>
                    <SelectItem value="auto_blacklist">
                      {t("optionsEnhanceModeAutoBlacklist")}
                    </SelectItem>
                    <SelectItem value="auto_whitelist">
                      {t("optionsEnhanceModeAutoWhitelist")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {enhanceSiteMode === "manual" ? (
              <div className="rounded-2xl border border-indigo-100/60 dark:border-indigo-500/20 bg-indigo-50/40 dark:bg-indigo-500/10 p-5">
                <div className="text-sm font-bold text-gray-900 dark:text-white">
                  {t("optionsEnhanceModeManualHintTitle")}
                </div>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-300/90 font-medium leading-relaxed">
                  {t("optionsEnhanceModeManualHintDesc")}
                </div>
              </div>
            ) : (
              <div className="pt-2">
                {enhanceSiteMode === "auto_whitelist" ? (
                  <div className="space-y-4">
                    <Label className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      {t("optionsAllowedSitesLabel")}
                    </Label>
                    <Textarea
                      value={form.allowedSites.join("\n")}
                      onChange={(e) => {
                        const lines = e.target.value
                          .split("\n")
                          .map(normalizeSiteEntry)
                          .filter(Boolean) as string[];
                        setForm({ ...form, allowedSites: dedupeStrings(lines) });
                      }}
                      rows={8}
                      className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-2xl p-4 focus:ring-indigo-500/30 font-medium transition-all"
                      placeholder={t("optionsSiteEntryPlaceholder")}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Label className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2.5">
                      <AlertCircle className="h-4 w-4 text-rose-500" />
                      {t("optionsExcludedSitesLabel")}
                    </Label>
                    <Textarea
                      value={form.excludedSites.join("\n")}
                      onChange={(e) => {
                        const lines = e.target.value
                          .split("\n")
                          .map(normalizeSiteEntry)
                          .filter(Boolean) as string[];
                        setForm({
                          ...form,
                          excludedSites: dedupeStrings(lines),
                        });
                      }}
                      rows={8}
                      className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-2xl p-4 focus:ring-rose-500/20 font-medium transition-all"
                      placeholder={t("optionsSiteEntryPlaceholder")}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );

  if (embedded) {
    return body;
  }

  return (
    <>
      <header className="space-y-3">
        <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 dark:text-white">
          {t("optionsTab_sites")}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed font-medium text-sm md:text-base">
          {t("optionsSiteModeDesc")}
        </p>
      </header>

      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        {body}
      </AiGate>
    </>
  );
}

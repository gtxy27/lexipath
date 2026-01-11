import React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Textarea } from "../../components/ui/textarea";
import { Label } from "../../components/ui/label";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { AiGate } from "../AiGate";
import { OptionsPageHeader } from "../components/OptionsPageHeader";
import { OptionsRow } from "../components/OptionsRow";
import { OptionsSection } from "../components/OptionsSection";
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

  const inner = (
    <div className="space-y-8">
      {(() => {
        type EnhanceSiteMode = "manual" | "auto_blacklist" | "auto_whitelist";
        const enhanceSiteMode: EnhanceSiteMode = form.autoEnhance
          ? form.siteMode === "whitelist"
            ? "auto_whitelist"
            : "auto_blacklist"
          : "manual";

        return (
          <>
            <OptionsRow
              title={t("optionsEnhanceModeLabel")}
              description={t("optionsEnhanceModeDesc")}
            >
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
                <SelectTrigger className="w-full sm:w-56 h-11 rounded-lg text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">{t("optionsEnhanceModeManual")}</SelectItem>
                  <SelectItem value="auto_blacklist">
                    {t("optionsEnhanceModeAutoBlacklist")}
                  </SelectItem>
                  <SelectItem value="auto_whitelist">
                    {t("optionsEnhanceModeAutoWhitelist")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </OptionsRow>

            {enhanceSiteMode === "manual" ? (
              <div className="rounded-xl border border-border bg-muted/15 p-5">
                <div className="text-sm font-medium">
                  {t("optionsEnhanceModeManualHintTitle")}
                </div>
                <div className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {t("optionsEnhanceModeManualHintDesc")}
                </div>
              </div>
            ) : (
              <div className="pt-2">
                {enhanceSiteMode === "auto_whitelist" ? (
                  <div className="space-y-4">
                    <Label className="text-sm font-medium flex items-center gap-2.5">
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
                      className="rounded-lg p-3"
                      placeholder={t("optionsSiteEntryPlaceholder")}
                    />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <Label className="text-sm font-medium flex items-center gap-2.5">
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
                      className="rounded-lg p-3"
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

  const body = (
    <OptionsSection className="shadow-none">
      {inner}
    </OptionsSection>
  );

  if (embedded) {
    return inner;
  }

  return (
    <>
      <OptionsPageHeader
        title={t("optionsTab_sites")}
        description={t("optionsSiteModeDesc")}
      />

      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        {body}
      </AiGate>
    </>
  );
}

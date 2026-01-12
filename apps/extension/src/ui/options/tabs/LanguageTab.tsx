import React, { useMemo } from "react";
import browser from "webextension-polyfill";
import {
  CEFRLevelSchema,
  JLPTLevelSchema,
  PromptStyleKeySchema,
  SupportedLanguageSchema,
  TOPIKLevelSchema,
  type CEFRLevel,
  type ProficiencyPreference,
  type Settings,
} from "@lexipath/core";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { ArrowDown, ArrowUp, MousePointerClick, Sparkles, Volume2 } from "lucide-react";
import { AiGate } from "../AiGate";
import {
  IELTS_BANDS,
  NATIVE_LANGUAGE_OPTIONS,
  defaultPreferenceForScale,
  deriveCefrFromPreference,
  getProficiencyScaleOptions,
  isScaleApplicable,
  type ProficiencyScaleOption,
} from "../optionsLogic";
import { t } from "../optionsI18n";
import { sendMessage } from "../optionsMessages";
import type { FormState } from "../optionsTypes";

export function LanguageTab(props: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  aiEnabled: boolean;
  onOpenChannels: () => void;
}): React.ReactElement {
  const { form, setForm, aiEnabled, onOpenChannels } = props;

  const wordCardSectionsOrder = useMemo(() => {
    const all = ["definition", "translation", "example", "exampleTranslation"] as const;
    const raw = (form.wordCardSectionsOrder ?? all) as string[];
    const seen = new Set<string>();
    const next: Array<(typeof all)[number]> = [];
    for (const item of raw) {
      if (!all.includes(item as any)) continue;
      if (seen.has(item)) continue;
      seen.add(item);
      next.push(item as any);
    }
    for (const item of all) {
      if (seen.has(item)) continue;
      next.push(item);
    }
    return next;
  }, [form.wordCardSectionsOrder]);

  return (
    <>
      <header className="space-y-3">
        <h2 className="text-2xl font-semibold tracking-tight">
          {t("optionsTab_learning")}
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {t("optionsLearningDesc")}
        </p>
      </header>

      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4 items-stretch">
          <div className="md:col-span-2 md:order-1 bg-card border border-border rounded-xl p-6 space-y-5">
            <h4 className="text-sm font-medium">
              {t("optionsLanguageTitle")}
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2.5">
                <Label className="text-xs text-muted-foreground">
                  {t("nativeLanguage")}
                </Label>
                <Select
                  value={form.nativeLanguage}
                  onValueChange={(v) => {
                    const nextNativeLanguage = v as Settings["nativeLanguage"];
                    const currentScale = (form.proficiencyPreference?.standard ??
                      "CEFR") as ProficiencyScaleOption;
                    const targetScale = (form.targetProficiencyPreference?.standard ??
                      "CEFR") as ProficiencyScaleOption;
                    const currentScaleApplicable = isScaleApplicable({
                      scale: currentScale,
                      targetLanguage: form.targetLanguage,
                      nativeLanguage: nextNativeLanguage,
                    });
                    const targetScaleApplicable = isScaleApplicable({
                      scale: targetScale,
                      targetLanguage: form.targetLanguage,
                      nativeLanguage: nextNativeLanguage,
                    });
                    setForm({
                      ...form,
                      nativeLanguage: nextNativeLanguage,
                      ...(currentScaleApplicable ? {} : { proficiencyPreference: undefined }),
                      ...(targetScaleApplicable
                        ? {}
                        : { targetProficiencyPreference: undefined }),
                    });
                  }}
                >
                  <SelectTrigger className="h-11 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border max-h-60">
                    {NATIVE_LANGUAGE_OPTIONS.map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        {t(`languageNative_${lang.replace("-", "_")}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2.5">
                <Label className="text-xs text-muted-foreground">
                  {t("targetLanguage")}
                </Label>
                <Select
                  value={form.targetLanguage}
                  onValueChange={(v) => {
                    const nextTargetLanguage = v as Settings["targetLanguage"];
                    const currentScale = (form.proficiencyPreference?.standard ??
                      "CEFR") as ProficiencyScaleOption;
                    const targetScale = (form.targetProficiencyPreference?.standard ??
                      "CEFR") as ProficiencyScaleOption;
                    const currentScaleApplicable = isScaleApplicable({
                      scale: currentScale,
                      targetLanguage: nextTargetLanguage,
                      nativeLanguage: form.nativeLanguage,
                    });
                    const targetScaleApplicable = isScaleApplicable({
                      scale: targetScale,
                      targetLanguage: nextTargetLanguage,
                      nativeLanguage: form.nativeLanguage,
                    });
                    setForm({
                      ...form,
                      targetLanguage: nextTargetLanguage,
                      ...(currentScaleApplicable ? {} : { proficiencyPreference: undefined }),
                      ...(targetScaleApplicable
                        ? {}
                        : { targetProficiencyPreference: undefined }),
                    });
                  }}
                >
                  <SelectTrigger className="h-11 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border max-h-60">
                    {SupportedLanguageSchema.options.map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        {t(`languageTarget_${lang}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="md:order-2 bg-card border border-border rounded-xl p-6 space-y-5">
            <h4 className="text-sm font-medium">
              {t("optionsLearningLevelsTitle")}
            </h4>

            <div className="space-y-5">
              <div className="text-xs text-muted-foreground">
                {t("optionsUserLevelTitle")}
              </div>
              <div className="space-y-2.5">
                <Label className="text-xs text-muted-foreground">
                  {t("optionsProficiencyScaleLabel")}
                </Label>
                <Select
                  value={
                    (form.proficiencyPreference?.standard ??
                      "CEFR") as ProficiencyScaleOption
                  }
                  onValueChange={(v) => {
                    const nextScale = v as ProficiencyScaleOption;
                    const nextPreference = defaultPreferenceForScale(nextScale);
                    if (!nextPreference) {
                      setForm({ ...form, proficiencyPreference: undefined });
                      return;
                    }
                    setForm({
                      ...form,
                      proficiencyPreference: nextPreference,
                      proficiencyLevel: deriveCefrFromPreference(nextPreference),
                    });
                  }}
                >
                  <SelectTrigger className="h-11 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border max-h-60">
                    {getProficiencyScaleOptions({
                      targetLanguage: form.targetLanguage,
                      nativeLanguage: form.nativeLanguage,
                    }).map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.proficiencyPreference ? (
                <div className="space-y-2.5">
                  {form.proficiencyPreference.standard !== "CET-4" &&
                  form.proficiencyPreference.standard !== "CET-6" ? (
                    <Label className="text-xs text-muted-foreground">
                      {t("optionsProficiencyScaleValueLabel")}
                    </Label>
                  ) : null}

                  {form.proficiencyPreference.standard === "IELTS" ? (
                    <Select
                      value={form.proficiencyPreference.value}
                      onValueChange={(v) => {
                        const next: ProficiencyPreference = {
                          standard: "IELTS",
                          value: v,
                        };
                        setForm({
                          ...form,
                          proficiencyPreference: next,
                          proficiencyLevel: deriveCefrFromPreference(next),
                        });
                      }}
                    >
                      <SelectTrigger className="h-11 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border max-h-60">
                        {IELTS_BANDS.map((band) => (
                          <SelectItem key={band} value={band}>
                            {band}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  {form.proficiencyPreference.standard === "JLPT" ? (
                    <Select
                      value={form.proficiencyPreference.value}
                      onValueChange={(v) => {
                        const next: ProficiencyPreference = {
                          standard: "JLPT",
                          value: v,
                        };
                        setForm({
                          ...form,
                          proficiencyPreference: next,
                          proficiencyLevel: deriveCefrFromPreference(next),
                        });
                      }}
                    >
                      <SelectTrigger className="h-11 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {JLPTLevelSchema.options.map((level) => (
                          <SelectItem key={level} value={level}>
                            {t(`proficiency_${level}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  {form.proficiencyPreference.standard === "TOPIK" ? (
                    <Select
                      value={form.proficiencyPreference.value}
                      onValueChange={(v) => {
                        const next: ProficiencyPreference = {
                          standard: "TOPIK",
                          value: v,
                        };
                        setForm({
                          ...form,
                          proficiencyPreference: next,
                          proficiencyLevel: deriveCefrFromPreference(next),
                        });
                      }}
                    >
                      <SelectTrigger className="h-11 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {TOPIKLevelSchema.options.map((level) => (
                          <SelectItem key={level} value={String(level)}>
                            {t(`proficiency_TOPIK${level}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  <div className="p-3 rounded-lg bg-muted/40 border border-border">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t("optionsProficiencyDerivedCefr", [
                        form.proficiencyLevel,
                      ])}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                      {t(`proficiencyRequirement_${form.proficiencyLevel}`)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <Label className="text-xs text-muted-foreground">
                    {t("proficiencyLevel")}
                  </Label>
                  <Select
                    value={form.proficiencyLevel}
                    onValueChange={(v) =>
                      setForm({ ...form, proficiencyLevel: v as CEFRLevel })
                    }
                  >
                    <SelectTrigger className="h-11 rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {CEFRLevelSchema.options.map((level) => (
                        <SelectItem key={level} value={level}>
                          {t(`proficiency_${level}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="p-3 rounded-lg bg-muted/40 border border-border">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t(`proficiencyRequirement_${form.proficiencyLevel}`)}
                    </p>
                  </div>
                </div>
              )}

              <div className="h-px bg-border my-2" />

              <div className="text-xs text-muted-foreground">
                {t("optionsTargetLevelTitle")}
              </div>

              <div className="space-y-2.5">
                <Label className="text-xs text-muted-foreground">
                  {t("optionsProficiencyScaleLabel")}
                </Label>
                <Select
                  value={
                    (form.targetProficiencyPreference?.standard ??
                      "CEFR") as ProficiencyScaleOption
                  }
                  onValueChange={(v) => {
                    const nextScale = v as ProficiencyScaleOption;
                    const nextPreference = defaultPreferenceForScale(nextScale);
                    if (!nextPreference) {
                      setForm({ ...form, targetProficiencyPreference: undefined });
                      return;
                    }
                    setForm({
                      ...form,
                      targetProficiencyPreference: nextPreference,
                      targetProficiencyLevel: deriveCefrFromPreference(nextPreference),
                    });
                  }}
                >
                  <SelectTrigger className="h-11 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border max-h-60">
                    {getProficiencyScaleOptions({
                      targetLanguage: form.targetLanguage,
                      nativeLanguage: form.nativeLanguage,
                    }).map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.targetProficiencyPreference ? (
                <div className="space-y-2.5">
                  {form.targetProficiencyPreference.standard !== "CET-4" &&
                  form.targetProficiencyPreference.standard !== "CET-6" ? (
                    <Label className="text-xs text-muted-foreground">
                      {t("optionsProficiencyScaleValueLabel")}
                    </Label>
                  ) : null}

                  {form.targetProficiencyPreference.standard === "IELTS" ? (
                    <Select
                      value={form.targetProficiencyPreference.value}
                      onValueChange={(v) => {
                        const next: ProficiencyPreference = {
                          standard: "IELTS",
                          value: v,
                        };
                        setForm({
                          ...form,
                          targetProficiencyPreference: next,
                          targetProficiencyLevel: deriveCefrFromPreference(next),
                        });
                      }}
                    >
                      <SelectTrigger className="h-11 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border max-h-60">
                        {IELTS_BANDS.map((band) => (
                          <SelectItem key={band} value={band}>
                            {band}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  {form.targetProficiencyPreference.standard === "JLPT" ? (
                    <Select
                      value={form.targetProficiencyPreference.value}
                      onValueChange={(v) => {
                        const next: ProficiencyPreference = {
                          standard: "JLPT",
                          value: v,
                        };
                        setForm({
                          ...form,
                          targetProficiencyPreference: next,
                          targetProficiencyLevel: deriveCefrFromPreference(next),
                        });
                      }}
                    >
                      <SelectTrigger className="h-11 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {JLPTLevelSchema.options.map((level) => (
                          <SelectItem key={level} value={level}>
                            {t(`proficiency_${level}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  {form.targetProficiencyPreference.standard === "TOPIK" ? (
                    <Select
                      value={form.targetProficiencyPreference.value}
                      onValueChange={(v) => {
                        const next: ProficiencyPreference = {
                          standard: "TOPIK",
                          value: v,
                        };
                        setForm({
                          ...form,
                          targetProficiencyPreference: next,
                          targetProficiencyLevel: deriveCefrFromPreference(next),
                        });
                      }}
                    >
                      <SelectTrigger className="h-11 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border">
                        {TOPIKLevelSchema.options.map((level) => (
                          <SelectItem key={level} value={String(level)}>
                            {t(`proficiency_TOPIK${level}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  <div className="p-3 rounded-lg bg-muted/40 border border-border">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t("optionsProficiencyDerivedCefr", [
                        form.targetProficiencyLevel,
                      ])}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                      {t(`proficiencyRequirement_${form.targetProficiencyLevel}`)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <Label className="text-xs text-muted-foreground">
                    {t("optionsTargetLevelTitle")}
                  </Label>
                  <Select
                    value={form.targetProficiencyLevel}
                    onValueChange={(v) =>
                      setForm({ ...form, targetProficiencyLevel: v as CEFRLevel })
                    }
                  >
                    <SelectTrigger className="h-11 rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      {CEFRLevelSchema.options.map((level) => (
                        <SelectItem key={level} value={level}>
                          {t(`proficiency_${level}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="p-3 rounded-lg bg-muted/40 border border-border">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {t(`proficiencyRequirement_${form.targetProficiencyLevel}`)}
                    </p>
                  </div>
                </div>
              )}

              <div className="p-4 rounded-lg bg-muted/40 border border-border">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("optionsProficiencyHint")}
                </p>
              </div>
            </div>
          </div>

          <div className="md:order-3 bg-card border border-border rounded-xl p-6 space-y-5">
            <h4 className="text-sm font-medium">
              {t("optionsWordCardTitle")}
            </h4>

            <div className="space-y-5">
              <div className="flex items-center justify-between gap-6 rounded-lg border border-border bg-muted/40 p-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <Volume2 className="h-4 w-4 text-primary" />
                    {t("optionsWordCardAutoPronounceLabel")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("optionsWordCardAutoPronounceDesc")}
                  </div>
                </div>
                <Switch
                  checked={form.wordCardAutoPronounce ?? true}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, wordCardAutoPronounce: checked })
                  }
                  className="data-[state=checked]:bg-primary"
                />
              </div>

              <div className="space-y-2.5">
                <Label className="text-xs text-muted-foreground">
                  {t("optionsWordCardEnglishAccentLabel")}
                </Label>
                <Select
                  value={form.wordCardEnglishAccent ?? "us"}
                  onValueChange={(value) =>
                    setForm({
                      ...form,
                      wordCardEnglishAccent: value as Settings["wordCardEnglishAccent"],
                    })
                  }
                >
                  <SelectTrigger className="h-11 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border-border">
                    <SelectItem value="us">{t("optionsWordCardEnglishAccentUs")}</SelectItem>
                    <SelectItem value="uk">{t("optionsWordCardEnglishAccentUk")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-6 rounded-lg border border-border bg-muted/40 p-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <MousePointerClick className="h-4 w-4 text-primary" />
                    {t("optionsWebSelectionExplainLabel")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("optionsWebSelectionExplainDesc")}
                  </div>
                </div>
                <Switch
                  checked={form.webSelectionExplainEnabled ?? true}
                  onCheckedChange={(checked) =>
                    setForm({ ...form, webSelectionExplainEnabled: checked })
                  }
                  className="data-[state=checked]:bg-primary"
                />
              </div>

              <div className="space-y-3">
                <div className="text-xs text-muted-foreground ml-1">
                  {t("optionsWordCardOrderLabel")}
                </div>
                <div className="space-y-2">
                  {wordCardSectionsOrder.map((key, index) => {
                    const labelKey = `optionsWordCardSection_${key}`;
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/20 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            {t(labelKey)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 rounded-lg border border-border bg-background"
                            disabled={index === 0}
                            onClick={() => {
                              if (index === 0) return;
                              const next = wordCardSectionsOrder.slice();
                              const [item] = next.splice(index, 1);
                              if (!item) return;
                              next.splice(index - 1, 0, item);
                              setForm({ ...form, wordCardSectionsOrder: next as any });
                            }}
                            aria-label={t("optionsWordCardMoveUp")}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-9 w-9 rounded-lg border border-border bg-background"
                            disabled={index === wordCardSectionsOrder.length - 1}
                            onClick={() => {
                              if (index === wordCardSectionsOrder.length - 1) return;
                              const next = wordCardSectionsOrder.slice();
                              const [item] = next.splice(index, 1);
                              if (!item) return;
                              next.splice(index + 1, 0, item);
                              setForm({ ...form, wordCardSectionsOrder: next as any });
                            }}
                            aria-label={t("optionsWordCardMoveDown")}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground ml-1">
                  {t("optionsWordCardOrderHint")}
                </p>
              </div>
            </div>
          </div>

          <div className="md:col-span-2 md:order-4 bg-card border border-border rounded-xl p-6 space-y-5">
            <h4 className="text-sm font-medium">
              {t("optionsWebEnhanceModeLabel")}
            </h4>

            <div className="space-y-5">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("optionsWebEnhanceModeDesc")}
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2.5">
                  <Label className="text-xs text-muted-foreground">
                    {t("optionsWebEnhanceModeTargetLabel")}
                  </Label>
                  <Select
                    value={form.webEnhanceMode}
                    onValueChange={(v) =>
                      setForm({ ...form, webEnhanceMode: v as Settings["webEnhanceMode"] })
                    }
                  >
                    <SelectTrigger className="h-11 rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="light">{t("optionsWebEnhanceModeLight")}</SelectItem>
                      <SelectItem value="i_plus_1">{t("optionsWebEnhanceModeIPlus1")}</SelectItem>
                      <SelectItem value="full">{t("optionsWebEnhanceModeFull")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2.5">
                  <Label className="text-xs text-muted-foreground">
                    {t("optionsWebEnhanceModeNativeLabel")}
                  </Label>
                  <Select
                    value={form.webEnhanceModeNative}
                    onValueChange={(v) =>
                      setForm({
                        ...form,
                        webEnhanceModeNative: v as Settings["webEnhanceModeNative"],
                      })
                    }
                  >
                    <SelectTrigger className="h-11 rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-popover border-border">
                      <SelectItem value="light">{t("optionsWebEnhanceModeLight")}</SelectItem>
                      <SelectItem value="i_plus_1">{t("optionsWebEnhanceModeIPlus1")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground leading-relaxed ml-1">
                    {t("optionsWebEnhanceModeNativeHint")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {form.hasCompletedOnboarding ? null : (
            <div className="md:col-span-2 md:order-5 bg-card border border-border rounded-xl p-6 space-y-5">
              <h4 className="text-sm font-medium">
                {t("openOnboarding")}
              </h4>

              <div className="space-y-5">
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {t("optionsOpenOnboardingDesc")}
                </p>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto h-10 rounded-lg border border-border bg-background font-medium text-xs"
                  onClick={() => {
                    const url = browser.runtime.getURL("src/ui/onboarding/index.html");
                    globalThis.open?.(url, "_blank");
                  }}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  {t("openOnboarding")}
                </Button>
              </div>
            </div>
          )}

          <div className="md:col-span-2 md:order-6 bg-card border border-border rounded-xl p-6 space-y-5">
            <h4 className="text-sm font-medium">
              {t("optionsEnglishCorrectionTitle")}
            </h4>

            <div className="space-y-5">
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t("optionsEnglishCorrectionDesc")}
              </p>

              <div className="flex items-center justify-between gap-6 rounded-lg border border-border bg-muted/40 p-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium">
                    {t("optionsEnglishCorrectionEnabled")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("optionsEnglishCorrectionEnabledDesc")}
                  </div>
                </div>
                <Switch
                  checked={form.englishCorrection.enabled}
                  onCheckedChange={(checked) =>
                    setForm({
                      ...form,
                      englishCorrection: {
                        ...form.englishCorrection,
                        enabled: checked,
                      },
                    })
                  }
                />
              </div>

              {form.englishCorrection.enabled ? (
                <>
                  <div className="space-y-2.5">
                    <Label className="text-xs text-muted-foreground">
                      {t("optionsPromptStyleLabel")}
                    </Label>
                    <Select
                      value={form.promptStyle}
                      onValueChange={(v) =>
                        setForm({ ...form, promptStyle: v as Settings["promptStyle"] })
                      }
                    >
                      <SelectTrigger className="h-11 rounded-lg">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover border-border max-h-60">
                        {PromptStyleKeySchema.options.map((styleKey) => (
                          <SelectItem key={styleKey} value={styleKey}>
                            {t(`promptStyle_${styleKey}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground leading-relaxed ml-1">
                      {t("optionsPromptStyleDesc")}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-2.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("optionsEnglishCorrectionTriggerTimeout")}
                      </Label>
                      <Input
                        type="number"
                        min={100}
                        max={2000}
                        value={String(form.englishCorrection.triggerTimeout)}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          if (!Number.isFinite(next)) return;
                          setForm({
                            ...form,
                            englishCorrection: {
                              ...form.englishCorrection,
                              triggerTimeout: next,
                            },
                          });
                        }}
                        className="h-11 rounded-lg"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("optionsEnglishCorrectionTriggerTimeoutDesc")}
                      </p>
                    </div>

                    <div className="space-y-2.5">
                      <Label className="text-xs text-muted-foreground">
                        {t("optionsEnglishCorrectionAutoCloseDelay")}
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={10000}
                        value={String(form.englishCorrection.autoCloseDelay)}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          if (!Number.isFinite(next)) return;
                          setForm({
                            ...form,
                            englishCorrection: {
                              ...form.englishCorrection,
                              autoCloseDelay: next,
                            },
                          });
                        }}
                        className="h-11 rounded-lg"
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("optionsEnglishCorrectionAutoCloseDelayDesc")}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-6 rounded-lg border border-border bg-muted/40 p-4">
                    <div className="space-y-1">
                      <div className="text-sm font-medium">
                        {t("optionsEnglishCorrectionShowUndo")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t("optionsEnglishCorrectionShowUndoDesc")}
                      </div>
                    </div>
                    <Switch
                      checked={form.englishCorrection.showUndoButton}
                      onCheckedChange={(checked) =>
                        setForm({
                          ...form,
                          englishCorrection: {
                            ...form.englishCorrection,
                            showUndoButton: checked,
                          },
                        })
                      }
                    />
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </AiGate>
    </>
  );
}

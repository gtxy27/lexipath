import React from "react";
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
import { Sparkles } from "lucide-react";
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

  return (
    <>
      <header className="space-y-3">
        <h2 className="text-3xl md:text-4xl font-black tracking-tight text-gray-900 dark:text-white">
          {t("optionsTab_learning")}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 max-w-2xl leading-relaxed font-medium text-sm md:text-base">
          {t("optionsLearningDesc")}
        </p>
      </header>

      <AiGate enabled={aiEnabled} onOpenChannels={onOpenChannels}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-4">
          <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("optionsLanguageTitle")}
            </h4>

            <div className="space-y-5">
              <div className="space-y-2.5">
                <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
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
                  <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                    {NATIVE_LANGUAGE_OPTIONS.map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        {t(`languageNative_${lang.replace("-", "_")}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2.5">
                <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
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
                  <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
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

          <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("optionsLearningLevelsTitle")}
            </h4>

            <div className="space-y-5">
              <div className="text-xs font-black uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
                {t("optionsUserLevelTitle")}
              </div>
              <div className="space-y-2.5">
                <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
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
                  <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
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
                    <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
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
                      <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
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
                      <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
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
                      <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                        {TOPIKLevelSchema.options.map((level) => (
                          <SelectItem key={level} value={String(level)}>
                            {t(`proficiency_TOPIK${level}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  <div className="p-3 rounded-xl bg-gray-50/40 dark:bg-white/5 border border-gray-200/60 dark:border-white/10">
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-medium">
                      {t("optionsProficiencyDerivedCefr", [
                        form.proficiencyLevel,
                      ])}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-medium mt-1">
                      {t(`proficiencyRequirement_${form.proficiencyLevel}`)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
                    {t("proficiencyLevel")}
                  </Label>
                  <Select
                    value={form.proficiencyLevel}
                    onValueChange={(v) =>
                      setForm({ ...form, proficiencyLevel: v as CEFRLevel })
                    }
                  >
                    <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                      {CEFRLevelSchema.options.map((level) => (
                        <SelectItem key={level} value={level}>
                          {t(`proficiency_${level}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="p-3 rounded-xl bg-gray-50/40 dark:bg-white/5 border border-gray-200/60 dark:border-white/10">
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-medium">
                      {t(`proficiencyRequirement_${form.proficiencyLevel}`)}
                    </p>
                  </div>
                </div>
              )}

              <div className="h-px bg-gray-100 dark:bg-white/5 my-2" />

              <div className="text-xs font-black uppercase tracking-[0.2em] text-gray-500 dark:text-gray-400">
                {t("optionsTargetLevelTitle")}
              </div>

              <div className="space-y-2.5">
                <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
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
                  <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
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
                    <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
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
                      <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
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
                      <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
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
                      <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                        {TOPIKLevelSchema.options.map((level) => (
                          <SelectItem key={level} value={String(level)}>
                            {t(`proficiency_TOPIK${level}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}

                  <div className="p-3 rounded-xl bg-gray-50/40 dark:bg-white/5 border border-gray-200/60 dark:border-white/10">
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-medium">
                      {t("optionsProficiencyDerivedCefr", [
                        form.targetProficiencyLevel,
                      ])}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-medium mt-1">
                      {t(`proficiencyRequirement_${form.targetProficiencyLevel}`)}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
                    {t("optionsTargetLevelTitle")}
                  </Label>
                  <Select
                    value={form.targetProficiencyLevel}
                    onValueChange={(v) =>
                      setForm({ ...form, targetProficiencyLevel: v as CEFRLevel })
                    }
                  >
                    <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                      {CEFRLevelSchema.options.map((level) => (
                        <SelectItem key={level} value={level}>
                          {t(`proficiency_${level}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="p-3 rounded-xl bg-gray-50/40 dark:bg-white/5 border border-gray-200/60 dark:border-white/10">
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-medium">
                      {t(`proficiencyRequirement_${form.targetProficiencyLevel}`)}
                    </p>
                  </div>
                </div>
              )}

              <div className="p-4 rounded-xl bg-indigo-50/30 dark:bg-indigo-500/5 border border-indigo-100/50 dark:border-indigo-500/10">
                <p className="text-xs text-gray-500 dark:text-gray-400 italic leading-relaxed font-medium">
                  {t("optionsProficiencyHint")}
                </p>
              </div>

              <div className="space-y-2.5">
                <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
                  {t("optionsPromptStyleLabel")}
                </Label>
                <Select
                  value={form.promptStyle}
                  onValueChange={(v) =>
                    setForm({ ...form, promptStyle: v as Settings["promptStyle"] })
                  }
                >
                  <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                    {PromptStyleKeySchema.options.map((styleKey) => (
                      <SelectItem key={styleKey} value={styleKey}>
                        {t(`promptStyle_${styleKey}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed font-medium ml-1">
                  {t("optionsPromptStyleDesc")}
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("optionsWebEnhanceModeLabel")}
            </h4>

            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed font-medium">
                {t("optionsWebEnhanceModeDesc")}
              </p>
              <Select
                value={form.webEnhanceMode}
                onValueChange={(v) =>
                  setForm({ ...form, webEnhanceMode: v as Settings["webEnhanceMode"] })
                }
              >
                <SelectTrigger className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10">
                  <SelectItem value="light">{t("optionsWebEnhanceModeLight")}</SelectItem>
                  <SelectItem value="i_plus_1">{t("optionsWebEnhanceModeIPlus1")}</SelectItem>
                  <SelectItem value="full">{t("optionsWebEnhanceModeFull")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("openOnboarding")}
            </h4>

            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed font-medium">
                {t("optionsOpenOnboardingDesc")}
              </p>
              {form.hasCompletedOnboarding ? (
                <div className="rounded-xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-4 text-sm text-gray-500 dark:text-gray-400 font-medium">
                  {t("optionsOnboardingCompletedHint")}
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full sm:w-auto h-10 rounded-xl border-gray-200 dark:border-white/10 bg-white/70 dark:bg-black/20 font-bold text-xs"
                  onClick={() => {
                    const url = browser.runtime.getURL("src/ui/onboarding/index.html");
                    globalThis.open?.(url, "_blank");
                  }}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  {t("openOnboarding")}
                </Button>
              )}
            </div>
          </div>

          <div className="md:col-span-2 bg-white dark:bg-[#15161e] border border-gray-200 dark:border-white/10 rounded-2xl p-7 space-y-7 shadow-sm">
            <h4 className="text-[11px] font-bold uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400/90">
              {t("optionsEnglishCorrectionTitle")}
            </h4>

            <div className="space-y-5">
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed font-medium">
                {t("optionsEnglishCorrectionDesc")}
              </p>

              <div className="flex items-center justify-between gap-6 rounded-xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-4">
                <div className="space-y-1">
                  <div className="text-sm font-bold text-gray-900 dark:text-white">
                    {t("optionsEnglishCorrectionEnabled")}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-2.5">
                      <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
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
                        className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                      />
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t("optionsEnglishCorrectionTriggerTimeoutDesc")}
                      </p>
                    </div>

                    <div className="space-y-2.5">
                      <Label className="text-[11px] font-bold uppercase tracking-widest text-gray-500 dark:text-gray-400 ml-1">
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
                        className="bg-gray-50/50 dark:bg-black/20 border-gray-200 dark:border-white/10 rounded-xl h-11 font-medium"
                      />
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">
                        {t("optionsEnglishCorrectionAutoCloseDelayDesc")}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-6 rounded-xl border border-gray-200/60 dark:border-white/10 bg-gray-50/40 dark:bg-white/5 p-4">
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-gray-900 dark:text-white">
                        {t("optionsEnglishCorrectionShowUndo")}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
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

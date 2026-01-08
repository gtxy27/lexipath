import React, { useEffect, useMemo, useState } from "react";
import browser from "webextension-polyfill";
import {
  CEFRLevelSchema,
  JLPTLevelSchema,
  TOPIKLevelSchema,
  SupportedLanguageSchema,
  proficiencyPreferenceToCefrLevel,
  type CEFRLevel,
  type NativeLanguage,
  type ProficiencyPreference,
  type SupportedLanguage,
  type Theme,
  type WebEnhanceMode,
} from "@lexipath/core";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { sendMessage } from "../../shared/messages";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Sparkles,
  Feather,
  TrendingUp,
  Waves,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useApplyTheme } from "../lib/theme";
import { motion, AnimatePresence } from "framer-motion";
import { ICON_URL } from "../lib/assets";

const log = createLogger("ui:Onboarding");

const IELTS_BANDS: readonly string[] = [
  "3.0",
  "3.5",
  "4.0",
  "4.5",
  "5.0",
  "5.5",
  "6.0",
  "6.5",
  "7.0",
  "7.5",
  "8.0",
  "8.5",
  "9.0",
];

type ProficiencyScaleOption = "CEFR" | ProficiencyPreference["standard"];

type OnboardingFormData = {
  targetLanguage: SupportedLanguage;
  proficiencyLevel: CEFRLevel;
  proficiencyPreference: ProficiencyPreference | undefined;
  targetProficiencyLevel: CEFRLevel;
  targetProficiencyPreference: ProficiencyPreference | undefined;
  webEnhanceMode: WebEnhanceMode;
};

function t(key: string, substitutions?: string | string[]): string {
  const message =
    substitutions === undefined
      ? browser.i18n.getMessage(key)
      : browser.i18n.getMessage(key, substitutions);
  return message || key;
}

function getProficiencyScaleOptions(input: {
  targetLanguage: SupportedLanguage;
  nativeLanguage: NativeLanguage;
}): Array<{ value: ProficiencyScaleOption; label: string }> {
  const options: Array<{ value: ProficiencyScaleOption; label: string }> = [
    { value: "CEFR", label: "CEFR" },
  ];

  if (input.targetLanguage === "en") {
    options.push({ value: "IELTS", label: "IELTS" });
    if (input.nativeLanguage === "zh-CN" || input.nativeLanguage === "zh-TW") {
      options.push({ value: "CET-4", label: "CET-4" });
      options.push({ value: "CET-6", label: "CET-6" });
    }
  }

  if (input.targetLanguage === "ja") options.push({ value: "JLPT", label: "JLPT" });
  if (input.targetLanguage === "ko") options.push({ value: "TOPIK", label: "TOPIK" });

  return options;
}

function isScaleApplicable(options: {
  scale: ProficiencyScaleOption;
  targetLanguage: SupportedLanguage;
  nativeLanguage: NativeLanguage;
}): boolean {
  if (options.scale === "CEFR") return true;
  if (options.scale === "IELTS") return options.targetLanguage === "en";
  if (options.scale === "CET-4" || options.scale === "CET-6") {
    return (
      options.targetLanguage === "en" &&
      (options.nativeLanguage === "zh-CN" || options.nativeLanguage === "zh-TW")
    );
  }
  if (options.scale === "JLPT") return options.targetLanguage === "ja";
  if (options.scale === "TOPIK") return options.targetLanguage === "ko";
  return false;
}

function defaultPreferenceForScale(
  scale: ProficiencyScaleOption,
): ProficiencyPreference | undefined {
  if (scale === "CEFR") return undefined;
  if (scale === "IELTS") return { standard: "IELTS", value: "6.5" };
  if (scale === "CET-4") return { standard: "CET-4", value: "pass" };
  if (scale === "CET-6") return { standard: "CET-6", value: "pass" };
  if (scale === "JLPT") return { standard: "JLPT", value: "N3" };
  if (scale === "TOPIK") return { standard: "TOPIK", value: "3" };
  return undefined;
}

function deriveCefrFromPreference(preference: ProficiencyPreference): CEFRLevel {
  return proficiencyPreferenceToCefrLevel(preference);
}

function displayProficiencyLabel(input: {
  level: CEFRLevel;
  preference: ProficiencyPreference | undefined;
}): string {
  const { level, preference } = input;
  if (!preference) return t(`proficiency_${level}`).replace("Proficiency ", "");

  if (preference.standard === "IELTS") return `IELTS ${preference.value}`;
  if (preference.standard === "CET-4" || preference.standard === "CET-6") {
    return preference.standard;
  }
  if (preference.standard === "JLPT") return t(`proficiency_${preference.value}`);
  if (preference.standard === "TOPIK") return t(`proficiency_TOPIK${preference.value}`);

  return t(`proficiency_${level}`).replace("Proficiency ", "");
}

export function Onboarding(): React.ReactElement {
  const [currentStep, setCurrentStep] = useState(1);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [nativeLanguage, setNativeLanguage] = useState<NativeLanguage>("zh-CN");
  const [blocked, setBlocked] = useState(false);
  const [formData, setFormData] = useState<OnboardingFormData>({
    targetLanguage: "en",
    proficiencyLevel: "B1",
    proficiencyPreference: undefined,
    targetProficiencyLevel: "B2",
    targetProficiencyPreference: undefined,
    webEnhanceMode: "i_plus_1",
  });
  const [saving, setSaving] = useState(false);

  useApplyTheme(theme);

  useEffect(() => {
    async function loadTheme() {
      try {
        const response = await sendMessage("GET_SETTINGS", undefined);
        if (response.ok) {
          setTheme(response.value.theme);
          setNativeLanguage(response.value.nativeLanguage);
          if (response.value.hasCompletedOnboarding) {
            setBlocked(true);
            try {
              await browser.runtime.openOptionsPage();
            } finally {
              globalThis.close?.();
            }
            return;
          }

          setFormData((prev) => {
            const userPref = response.value.proficiencyPreference ?? undefined;
            const targetPref = response.value.targetProficiencyPreference ?? undefined;

            const userPrefOk = userPref
              ? isScaleApplicable({
                  scale: userPref.standard,
                  targetLanguage: response.value.targetLanguage,
                  nativeLanguage: response.value.nativeLanguage,
                })
              : true;
            const targetPrefOk = targetPref
              ? isScaleApplicable({
                  scale: targetPref.standard,
                  targetLanguage: response.value.targetLanguage,
                  nativeLanguage: response.value.nativeLanguage,
                })
              : true;

            return {
              ...prev,
              targetLanguage: response.value.targetLanguage,
              proficiencyLevel: response.value.proficiencyLevel,
              proficiencyPreference: userPrefOk ? userPref : undefined,
              targetProficiencyLevel: response.value.targetProficiencyLevel,
              targetProficiencyPreference: targetPrefOk ? targetPref : undefined,
              webEnhanceMode: response.value.webEnhanceMode,
            };
          });
        }
      } catch (error: unknown) {
        log.warn("Failed to load onboarding theme; falling back to system", { message: getErrorMessage(error) });
      }
    }
    loadTheme();
  }, []);

  const targetLanguageOptions = useMemo(
    () =>
      SupportedLanguageSchema.options.map((value) => ({
        value,
        labelKey: `languageTarget_${value}`,
      })),
    [],
  );

  const scaleOptions = useMemo(
    () =>
      getProficiencyScaleOptions({
        targetLanguage: formData.targetLanguage,
        nativeLanguage,
      }),
    [formData.targetLanguage, nativeLanguage],
  );

  function handleTargetLanguageChange(newLanguage: SupportedLanguage) {
    const userPref = formData.proficiencyPreference;
    const targetPref = formData.targetProficiencyPreference;

    const userPrefOk = userPref
      ? isScaleApplicable({
          scale: userPref.standard,
          targetLanguage: newLanguage,
          nativeLanguage,
        })
      : true;
    const targetPrefOk = targetPref
      ? isScaleApplicable({
          scale: targetPref.standard,
          targetLanguage: newLanguage,
          nativeLanguage,
        })
      : true;

    setFormData({
      ...formData,
      targetLanguage: newLanguage,
      proficiencyPreference: userPrefOk ? userPref : undefined,
      targetProficiencyPreference: targetPrefOk ? targetPref : undefined,
    });
  }

  function handleNext() {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    }
  }

  function handlePrevious() {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  }

  async function handleFinish() {
    setSaving(true);
    try {
      await sendMessage("SET_SETTINGS", {
        targetLanguage: formData.targetLanguage,
        proficiencyLevel: formData.proficiencyLevel,
        proficiencyPreference: formData.proficiencyPreference,
        targetProficiencyLevel: formData.targetProficiencyLevel,
        targetProficiencyPreference: formData.targetProficiencyPreference,
        webEnhanceMode: formData.webEnhanceMode,
        hasCompletedOnboarding: true,
      });

      globalThis.close?.();
    } catch (error) {
      log.error("Failed to save onboarding settings", { message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  const progress = (currentStep / 3) * 100;
  const step1Valid =
    !!formData.targetLanguage &&
    !!formData.proficiencyLevel &&
    !!formData.targetProficiencyLevel;

  if (blocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <div className="max-w-md text-center space-y-3">
          <div className="text-lg font-black">{t("onboardingBlockedTitle")}</div>
          <div className="text-sm text-muted-foreground">{t("onboardingBlockedDesc")}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-white dark:bg-[#0d0e14] text-gray-900 dark:text-white relative overflow-hidden transition-colors duration-500">
      {/* Immersive background */}
      <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-indigo-600/5 dark:bg-indigo-600/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-purple-600/5 dark:bg-purple-600/20 rounded-full blur-[120px] animate-pulse" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl relative z-10"
      >
        <Card className="glass-card border-gray-100 dark:border-white/5 bg-white/80 dark:bg-white/5 backdrop-blur-2xl overflow-hidden rounded-3xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.15)] dark:shadow-[0_32px_64px_-12px_rgba(0,0,0,0.5)]">
          <CardHeader className="text-center pb-8 pt-10 px-8 relative overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-24 bg-indigo-500/5 dark:bg-indigo-500/10 blur-3xl rounded-full" />
            
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-premium p-[1px] shadow-2xl shadow-indigo-500/10 dark:shadow-indigo-500/20"
            >
              <div className="flex h-full w-full items-center justify-center rounded-[15px] bg-white dark:bg-[#0d0e14]">
                <img src={ICON_URL} className="h-9 w-9" alt={t("extensionName")} />
              </div>
            </motion.div>
            
            <CardTitle className="text-4xl font-black tracking-tighter text-gray-900 dark:text-white mb-2">
              {t("welcomeTitle")}
            </CardTitle>
            <CardDescription className="text-lg text-gray-500 dark:text-gray-400 font-bold max-w-md mx-auto leading-relaxed uppercase tracking-wider text-[11px]">
              {t("welcomeDesc")}
            </CardDescription>
          </CardHeader>

          <div className="px-10 py-0">
            <div
              role="progressbar"
              aria-label={t(
                "onboardingProgressAriaLabel",
                String(Math.round(progress)),
              )}
              aria-valuetext={t(
                "onboardingProgressAriaValueText",
                String(Math.round(progress)),
              )}
              className="relative h-1.5 w-full bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden"
            >
              <motion.div
                className="absolute top-0 left-0 h-full bg-gradient-premium rounded-full"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: "circOut" }}
              />
            </div>
            <div className="flex justify-between mt-3 px-1">
               <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 dark:text-indigo-400">{t("onboardingStepProgress", String(currentStep))}</span>
               <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{t("onboardingPercentComplete", String(Math.round(progress)))}</span>
            </div>
          </div>

          <CardContent className="p-10 min-h-[460px] flex flex-col">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.1 }}
                className="flex-1"
              >
                {currentStep === 1 && (
                  <div className="space-y-10">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
                        {t("onboardingStep1Title")}
                      </h2>
                      <p className="text-gray-400 dark:text-gray-500 font-bold text-[11px] uppercase tracking-wider leading-relaxed">
                        {t("onboardingStep1Desc")}
                      </p>
                    </div>

                    <div className="space-y-8">
                      <div className="space-y-4">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">
                          {t("onboardingTargetLanguageLabel")}
                        </Label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {targetLanguageOptions.map((option) => (
                            <Button
                              key={option.value}
                              variant="outline"
                              className={cn(
                                "h-auto py-4 px-4 rounded-2xl border-gray-100 dark:border-white/5 transition-all duration-300 relative overflow-hidden group",
                                formData.targetLanguage === option.value
                                  ? "bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-500/5 dark:shadow-indigo-500/10"
                                  : "bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                              )}
                              onClick={() => handleTargetLanguageChange(option.value)}
                            >
                              <div className="flex items-center justify-between w-full relative z-10">
                                <span className="font-bold tracking-wide">
                                  {t(option.labelKey)}
                                </span>
                                {formData.targetLanguage === option.value && (
                                  <motion.div layoutId="check" initial={{ scale: 0 }} animate={{ scale: 1 }}>
                                    <Check className="h-4 w-4 text-white" />
                                  </motion.div>
                                )}
                              </div>
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">
                          {t("onboardingUserLevelLabel")}
                        </Label>

                        {(() => {
                          const scale = (formData.proficiencyPreference?.standard ??
                            "CEFR") as ProficiencyScaleOption;

                          return (
                            <div className="space-y-4">
                              <Select
                                value={scale}
                                onValueChange={(v) => {
                                  const nextScale = v as ProficiencyScaleOption;
                                  const nextPref = defaultPreferenceForScale(nextScale);
                                  if (!nextPref) {
                                    setFormData({
                                      ...formData,
                                      proficiencyPreference: undefined,
                                    });
                                    return;
                                  }
                                  setFormData({
                                    ...formData,
                                    proficiencyPreference: nextPref,
                                    proficiencyLevel: deriveCefrFromPreference(nextPref),
                                  });
                                }}
                              >
                                <SelectTrigger
                                  data-testid="onboarding-user-level-scale"
                                  className="bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 rounded-xl h-11 font-bold text-xs"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                                  {scaleOptions.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              {formData.proficiencyPreference ? (
                                <div className="space-y-3">
                                  {formData.proficiencyPreference.standard === "IELTS" ? (
                                    <Select
                                      value={formData.proficiencyPreference.value}
                                      onValueChange={(v) => {
                                        const next: ProficiencyPreference = {
                                          standard: "IELTS",
                                          value: v,
                                        };
                                        setFormData({
                                          ...formData,
                                          proficiencyPreference: next,
                                          proficiencyLevel: deriveCefrFromPreference(next),
                                        });
                                      }}
                                    >
                                      <SelectTrigger
                                        data-testid="onboarding-user-level-value"
                                        className="bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 rounded-xl h-11 font-bold text-xs"
                                      >
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

                                  {formData.proficiencyPreference.standard === "JLPT" ? (
                                    <Select
                                      value={formData.proficiencyPreference.value}
                                      onValueChange={(v) => {
                                        const next: ProficiencyPreference = {
                                          standard: "JLPT",
                                          value: v,
                                        };
                                        setFormData({
                                          ...formData,
                                          proficiencyPreference: next,
                                          proficiencyLevel: deriveCefrFromPreference(next),
                                        });
                                      }}
                                    >
                                      <SelectTrigger
                                        data-testid="onboarding-user-level-value"
                                        className="bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 rounded-xl h-11 font-bold text-xs"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                                        {JLPTLevelSchema.options.map((level) => (
                                          <SelectItem key={level} value={level}>
                                            {t(`proficiency_${level}`)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : null}

                                  {formData.proficiencyPreference.standard === "TOPIK" ? (
                                    <Select
                                      value={formData.proficiencyPreference.value}
                                      onValueChange={(v) => {
                                        const next: ProficiencyPreference = {
                                          standard: "TOPIK",
                                          value: v,
                                        };
                                        setFormData({
                                          ...formData,
                                          proficiencyPreference: next,
                                          proficiencyLevel: deriveCefrFromPreference(next),
                                        });
                                      }}
                                    >
                                      <SelectTrigger
                                        data-testid="onboarding-user-level-value"
                                        className="bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 rounded-xl h-11 font-bold text-xs"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                                        {TOPIKLevelSchema.options.map((level) => (
                                          <SelectItem key={level} value={String(level)}>
                                            {t(`proficiency_TOPIK${level}`)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : null}

                                  <div className="text-xs text-gray-400 dark:text-gray-500 font-bold">
                                    {t("optionsProficiencyDerivedCefr", [
                                      formData.proficiencyLevel,
                                    ])}
                                  </div>
                                </div>
                              ) : (
                                <Select
                                  value={formData.proficiencyLevel}
                                  onValueChange={(v) =>
                                    setFormData({
                                      ...formData,
                                      proficiencyLevel: v as CEFRLevel,
                                    })
                                  }
                                >
                                  <SelectTrigger
                                    data-testid="onboarding-user-level-value"
                                    className="bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 rounded-xl h-11 font-bold text-xs"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                                    {CEFRLevelSchema.options.map((level) => (
                                      <SelectItem key={level} value={level}>
                                        {t(`proficiency_${level}`)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          );
                        })()}
                      </div>

                      <div className="space-y-4 pt-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">
                          {t("onboardingTargetLevelLabel")}
                        </Label>
                        {(() => {
                          const scale = (formData.targetProficiencyPreference?.standard ??
                            "CEFR") as ProficiencyScaleOption;

                          return (
                            <div className="space-y-4">
                              <Select
                                value={scale}
                                onValueChange={(v) => {
                                  const nextScale = v as ProficiencyScaleOption;
                                  const nextPref = defaultPreferenceForScale(nextScale);
                                  if (!nextPref) {
                                    setFormData({
                                      ...formData,
                                      targetProficiencyPreference: undefined,
                                    });
                                    return;
                                  }
                                  setFormData({
                                    ...formData,
                                    targetProficiencyPreference: nextPref,
                                    targetProficiencyLevel: deriveCefrFromPreference(nextPref),
                                  });
                                }}
                              >
                                <SelectTrigger
                                  data-testid="onboarding-target-level-scale"
                                  className="bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 rounded-xl h-11 font-bold text-xs"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                                  {scaleOptions.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>

                              {formData.targetProficiencyPreference ? (
                                <div className="space-y-3">
                                  {formData.targetProficiencyPreference.standard ===
                                  "IELTS" ? (
                                    <Select
                                      value={formData.targetProficiencyPreference.value}
                                      onValueChange={(v) => {
                                        const next: ProficiencyPreference = {
                                          standard: "IELTS",
                                          value: v,
                                        };
                                        setFormData({
                                          ...formData,
                                          targetProficiencyPreference: next,
                                          targetProficiencyLevel: deriveCefrFromPreference(next),
                                        });
                                      }}
                                    >
                                      <SelectTrigger
                                        data-testid="onboarding-target-level-value"
                                        className="bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 rounded-xl h-11 font-bold text-xs"
                                      >
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

                                  {formData.targetProficiencyPreference.standard ===
                                  "JLPT" ? (
                                    <Select
                                      value={formData.targetProficiencyPreference.value}
                                      onValueChange={(v) => {
                                        const next: ProficiencyPreference = {
                                          standard: "JLPT",
                                          value: v,
                                        };
                                        setFormData({
                                          ...formData,
                                          targetProficiencyPreference: next,
                                          targetProficiencyLevel: deriveCefrFromPreference(next),
                                        });
                                      }}
                                    >
                                      <SelectTrigger
                                        data-testid="onboarding-target-level-value"
                                        className="bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 rounded-xl h-11 font-bold text-xs"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                                        {JLPTLevelSchema.options.map((level) => (
                                          <SelectItem key={level} value={level}>
                                            {t(`proficiency_${level}`)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : null}

                                  {formData.targetProficiencyPreference.standard ===
                                  "TOPIK" ? (
                                    <Select
                                      value={formData.targetProficiencyPreference.value}
                                      onValueChange={(v) => {
                                        const next: ProficiencyPreference = {
                                          standard: "TOPIK",
                                          value: v,
                                        };
                                        setFormData({
                                          ...formData,
                                          targetProficiencyPreference: next,
                                          targetProficiencyLevel: deriveCefrFromPreference(next),
                                        });
                                      }}
                                    >
                                      <SelectTrigger
                                        data-testid="onboarding-target-level-value"
                                        className="bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 rounded-xl h-11 font-bold text-xs"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                                        {TOPIKLevelSchema.options.map((level) => (
                                          <SelectItem key={level} value={String(level)}>
                                            {t(`proficiency_TOPIK${level}`)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : null}

                                  <div className="text-xs text-gray-400 dark:text-gray-500 font-bold">
                                    {t("optionsProficiencyDerivedCefr", [
                                      formData.targetProficiencyLevel,
                                    ])}
                                  </div>
                                </div>
                              ) : (
                                <Select
                                  value={formData.targetProficiencyLevel}
                                  onValueChange={(v) =>
                                    setFormData({
                                      ...formData,
                                      targetProficiencyLevel: v as CEFRLevel,
                                    })
                                  }
                                >
                                  <SelectTrigger
                                    data-testid="onboarding-target-level-value"
                                    className="bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 rounded-xl h-11 font-bold text-xs"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="bg-white dark:bg-[#1a1b23] border-gray-200 dark:border-white/10 max-h-60">
                                    {CEFRLevelSchema.options.map((level) => (
                                      <SelectItem key={level} value={level}>
                                        {t(`proficiency_${level}`)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                )}

                {currentStep === 2 && (
                  <div className="space-y-10">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
                        {t("onboardingStep2Title")}
                      </h2>
                      <p className="text-gray-400 dark:text-gray-500 font-bold text-[11px] uppercase tracking-wider leading-relaxed">
                        {t("onboardingStep2Desc")}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400 ml-1">
                        {t("onboardingEnhanceModeLabel")}
                      </Label>

                      {[
                        {
                          value: "light" as const,
                          icon: Feather,
                          title: t("onboardingEnhanceModeBreezeTitle"),
                          desc: t("onboardingEnhanceModeBreezeDesc"),
                        },
                        {
                          value: "i_plus_1" as const,
                          icon: TrendingUp,
                          title: t("onboardingEnhanceModeGuidedTitle"),
                          desc: t("onboardingEnhanceModeGuidedDesc"),
                        },
                        {
                          value: "full" as const,
                          icon: Waves,
                          title: t("onboardingEnhanceModeImmersionTitle"),
                          desc: t("onboardingEnhanceModeImmersionDesc"),
                        },
                      ].map((mode) => (
                        <div
                          key={mode.value}
                          className={cn(
                          "relative group rounded-2xl border transition-all duration-300 p-5 cursor-pointer select-none",
                          formData.webEnhanceMode === mode.value
                            ? "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500/30"
                            : "bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 hover:border-gray-200 dark:hover:border-white/10"
                          )}
                          onClick={() => setFormData({ ...formData, webEnhanceMode: mode.value })}
                          role="button"
                          aria-label={mode.title}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-start gap-4">
                              <div className={cn(
                                "p-3 rounded-xl transition-colors",
                                formData.webEnhanceMode === mode.value
                                  ? "bg-indigo-500 text-white"
                                  : "bg-white dark:bg-[#0d0e14] text-gray-300 dark:text-gray-600"
                              )}>
                                <mode.icon className="h-6 w-6" />
                              </div>
                              <div className="space-y-1">
                                <h3 className="font-bold text-gray-900 dark:text-white tracking-tight">
                                  {mode.title}
                                </h3>
                                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider leading-tight">{mode.desc}</p>
                              </div>
                            </div>
                            <div
                              className={cn(
                                "h-6 w-6 rounded-full border flex items-center justify-center transition-colors",
                                formData.webEnhanceMode === mode.value
                                  ? "border-indigo-500 bg-indigo-500 text-white"
                                  : "border-gray-200 dark:border-white/10 text-transparent"
                              )}
                            >
                              <Check className="h-4 w-4" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {currentStep === 3 && (
                  <div className="space-y-10">
                    <div className="space-y-2">
                      <h2 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight text-center">
                        {t("onboardingStep3Title")}
                      </h2>
                      <p className="text-gray-400 dark:text-gray-500 font-bold text-[11px] uppercase tracking-wider leading-relaxed text-center">
                        {t("onboardingStep3Desc")}
                      </p>
                    </div>

                    <div className="relative group">
                       <div className="absolute -inset-1 rounded-[2rem] bg-gradient-to-r from-indigo-500/20 to-purple-500/20 blur opacity-75 group-hover:opacity-100 transition duration-1000" />
                       <Card className="relative bg-gray-50/50 dark:bg-[#0d0e14]/40 border-gray-100 dark:border-white/5 rounded-[2rem] overflow-hidden shadow-inner">
                          <CardContent className="p-10 grid grid-cols-1 sm:grid-cols-4 gap-8 text-center">
                            <div className="space-y-3">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 dark:text-indigo-400/70">
                                {t("onboardingSummaryTargetLanguage")}
                              </p>
                              <p data-testid="summary-target-lang" className="text-3xl font-black text-gray-900 dark:text-white tracking-tighter">
                                {t(`languageTarget_${formData.targetLanguage}`)}
                              </p>
                            </div>
                            <div className="space-y-3">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-500 dark:text-purple-400/70">
                                {t("onboardingUserLevelLabel")}
                              </p>
                              <p data-testid="summary-proficiency" className="text-3xl font-black text-gray-900 dark:text-white tracking-tighter">
                                {displayProficiencyLabel({
                                  level: formData.proficiencyLevel,
                                  preference: formData.proficiencyPreference,
                                })}
                              </p>
                            </div>
                            <div className="space-y-3">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-500 dark:text-teal-400/70">
                                {t("onboardingTargetLevelLabel")}
                              </p>
                              <p data-testid="summary-target-level" className="text-3xl font-black text-gray-900 dark:text-white tracking-tighter">
                                {displayProficiencyLabel({
                                  level: formData.targetProficiencyLevel,
                                  preference: formData.targetProficiencyPreference,
                                })}
                              </p>
                            </div>
                            <div className="space-y-3">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500 dark:text-emerald-400/70">
                                {t("onboardingSummaryEnhanceMode")}
                              </p>
                              <p data-testid="summary-enhance-mode" className="text-3xl font-black text-gray-900 dark:text-white tracking-tighter">
                                {t(`onboardingEnhanceModeSummary_${formData.webEnhanceMode}`)}
                              </p>
                            </div>
                          </CardContent>
                       </Card>
                    </div>

                    <div className="glass-card bg-gray-50 dark:bg-white/5 rounded-2xl p-6 border-gray-100 dark:border-indigo-500/10 text-center">
                       <p className="text-xs text-gray-400 dark:text-gray-500 font-bold uppercase tracking-widest leading-relaxed">
                          {t("onboardingSummaryNote")}
                       </p>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </CardContent>

          <CardFooter className="flex justify-between p-10 pt-0 relative z-10">
            <Button
              variant="ghost"
              onClick={handlePrevious}
              disabled={currentStep === 1}
              className="gap-2 h-12 px-6 text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 rounded-2xl transition-all font-bold"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("onboardingPrevious")}
            </Button>

            {currentStep < 3 ? (
              <Button
                onClick={handleNext}
                disabled={currentStep === 1 && !step1Valid}
                className="gap-2 h-12 px-8 bg-indigo-600 hover:bg-indigo-500 text-white rounded-2xl shadow-xl shadow-indigo-600/10 dark:shadow-indigo-600/20 transition-all font-bold group"
              >
                {t("onboardingNext")}
                <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </Button>
            ) : (
              <Button
                onClick={handleFinish}
                disabled={saving}
                className="gap-2 h-14 px-10 bg-gradient-premium text-white rounded-2xl shadow-2xl shadow-indigo-600/20 dark:shadow-indigo-600/30 transition-all font-black text-lg group"
              >
                {saving ? <Loader2 className="h-6 w-6 animate-spin" /> : <Sparkles className="h-6 w-6 group-hover:rotate-12 transition-transform" />}
                {saving ? t("optionsSaving") : t("onboardingFinish")}
              </Button>
            )}
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
}

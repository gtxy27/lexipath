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
    <div className="min-h-screen flex items-center justify-center p-6 bg-background text-foreground relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/12 dark:from-primary/6 via-transparent to-transparent opacity-70 dark:opacity-50" />
      <div className="pointer-events-none absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -right-48 h-[520px] w-[520px] rounded-full bg-muted/60 blur-3xl" />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl relative z-10"
      >
        <Card className="border border-border bg-card overflow-hidden rounded-xl shadow-sm">
          <CardHeader className="text-center pb-8 pt-10 px-8 relative overflow-hidden">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 dark:from-primary/5 via-transparent to-transparent opacity-70 dark:opacity-50" />
            <motion.div 
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-lg border bg-background"
            >
              <div className="flex h-full w-full items-center justify-center rounded-md bg-background">
                <img src={ICON_URL} className="h-9 w-9" alt={t("extensionName")} />
              </div>
            </motion.div>
            
            <CardTitle className="text-2xl font-semibold tracking-tight mb-2">
              {t("welcomeTitle")}
            </CardTitle>
            <CardDescription className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
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
              className="relative h-1.5 w-full bg-muted rounded-full overflow-hidden"
            >
              <motion.div
                className="absolute top-0 left-0 h-full bg-primary rounded-full"
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: "circOut" }}
              />
            </div>
            <div className="flex justify-between mt-3 px-1">
               <span className="text-xs text-muted-foreground">{t("onboardingStepProgress", String(currentStep))}</span>
               <span className="text-xs text-muted-foreground">{t("onboardingPercentComplete", String(Math.round(progress)))}</span>
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
                      <h2 className="text-xl font-semibold tracking-tight">
                        {t("onboardingStep1Title")}
                      </h2>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {t("onboardingStep1Desc")}
                      </p>
                    </div>

                    <div className="space-y-8">
                      <div className="space-y-4">
                        <Label className="text-xs text-muted-foreground ml-1">
                          {t("onboardingTargetLanguageLabel")}
                        </Label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {targetLanguageOptions.map((option) => (
                            <Button
                              key={option.value}
                              variant="outline"
                              className={cn(
                                "h-auto py-4 px-4 rounded-lg border border-border transition-colors",
                                formData.targetLanguage === option.value
                                  ? "bg-primary text-primary-foreground border-primary/50"
                                  : "bg-card hover:bg-muted/40 text-muted-foreground hover:text-foreground"
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
                        <Label className="text-xs text-muted-foreground ml-1">
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
                                  className="h-11 rounded-lg text-xs"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-popover border-border max-h-60">
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
                                        className="h-11 rounded-lg text-xs"
                                      >
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
                                        className="h-11 rounded-lg text-xs"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-popover border-border max-h-60">
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
                                        className="h-11 rounded-lg text-xs"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-popover border-border max-h-60">
                                        {TOPIKLevelSchema.options.map((level) => (
                                          <SelectItem key={level} value={String(level)}>
                                            {t(`proficiency_TOPIK${level}`)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : null}

                                  <div className="text-xs text-muted-foreground font-semibold">
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
                                    className="h-11 rounded-lg text-xs"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="bg-popover border-border max-h-60">
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
                        <Label className="text-xs text-muted-foreground ml-1">
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
                                  className="h-11 rounded-lg text-xs"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-popover border-border max-h-60">
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
                                        className="h-11 rounded-lg text-xs"
                                      >
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
                                        className="h-11 rounded-lg text-xs"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-popover border-border max-h-60">
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
                                        className="h-11 rounded-lg text-xs"
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent className="bg-popover border-border max-h-60">
                                        {TOPIKLevelSchema.options.map((level) => (
                                          <SelectItem key={level} value={String(level)}>
                                            {t(`proficiency_TOPIK${level}`)}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  ) : null}

                                  <div className="text-xs text-muted-foreground font-semibold">
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
                                    className="h-11 rounded-lg text-xs"
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent className="bg-popover border-border max-h-60">
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
                      <h2 className="text-xl font-semibold tracking-tight">
                        {t("onboardingStep2Title")}
                      </h2>
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {t("onboardingStep2Desc")}
                      </p>
                    </div>

                    <div className="space-y-4">
                      <Label className="text-xs text-muted-foreground ml-1">
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
                          "rounded-lg border transition-colors p-5 cursor-pointer select-none",
                          formData.webEnhanceMode === mode.value
                            ? "bg-primary/5 border-primary/30"
                            : "bg-card border-border hover:bg-muted/40"
                          )}
                          onClick={() => setFormData({ ...formData, webEnhanceMode: mode.value })}
                          role="button"
                          aria-label={mode.title}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-start gap-4">
                              <div className={cn(
                                "p-3 rounded-lg transition-colors",
                                formData.webEnhanceMode === mode.value
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground"
                              )}>
                                <mode.icon className="h-6 w-6" />
                              </div>
                              <div className="space-y-1">
                                <h3 className="font-medium tracking-tight">
                                  {mode.title}
                                </h3>
                                <p className="text-xs text-muted-foreground leading-relaxed">{mode.desc}</p>
                              </div>
                            </div>
                            <div
                              className={cn(
                                "h-6 w-6 rounded-full border flex items-center justify-center transition-colors",
                                formData.webEnhanceMode === mode.value
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border text-transparent"
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
                      <h2 className="text-xl font-semibold tracking-tight text-center">
                        {t("onboardingStep3Title")}
                      </h2>
                      <p className="text-sm text-muted-foreground leading-relaxed text-center">
                        {t("onboardingStep3Desc")}
                      </p>
                    </div>

                    <div>
                       <Card className="bg-muted/30 border border-border rounded-xl overflow-hidden">
                           <CardContent className="p-10 grid grid-cols-1 sm:grid-cols-4 gap-8 text-center">
                             <div className="space-y-3">
                              <p className="text-xs text-muted-foreground">
                                 {t("onboardingSummaryTargetLanguage")}
                              </p>
                              <p data-testid="summary-target-lang" className="text-2xl font-semibold tracking-tight">
                                 {t(`languageTarget_${formData.targetLanguage}`)}
                              </p>
                            </div>
                            <div className="space-y-3">
                              <p className="text-xs text-muted-foreground">
                                 {t("onboardingUserLevelLabel")}
                              </p>
                              <p data-testid="summary-proficiency" className="text-2xl font-semibold tracking-tight">
                                 {displayProficiencyLabel({
                                   level: formData.proficiencyLevel,
                                   preference: formData.proficiencyPreference,
                                 })}
                              </p>
                            </div>
                            <div className="space-y-3">
                              <p className="text-xs text-muted-foreground">
                                 {t("onboardingTargetLevelLabel")}
                              </p>
                              <p data-testid="summary-target-level" className="text-2xl font-semibold tracking-tight">
                                 {displayProficiencyLabel({
                                   level: formData.targetProficiencyLevel,
                                   preference: formData.targetProficiencyPreference,
                                 })}
                              </p>
                            </div>
                            <div className="space-y-3">
                              <p className="text-xs text-muted-foreground">
                                 {t("onboardingSummaryEnhanceMode")}
                              </p>
                              <p data-testid="summary-enhance-mode" className="text-2xl font-semibold tracking-tight">
                                 {t(`onboardingEnhanceModeSummary_${formData.webEnhanceMode}`)}
                              </p>
                            </div>
                           </CardContent>
                       </Card>
                    </div>

                    <div className="bg-muted/30 border border-border rounded-lg p-5 text-center">
                       <p className="text-xs text-muted-foreground leading-relaxed">
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
              className="gap-2 h-10 px-4 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors font-medium"
            >
              <ChevronLeft className="h-4 w-4" />
              {t("onboardingPrevious")}
            </Button>

            {currentStep < 3 ? (
              <Button
                onClick={handleNext}
                disabled={currentStep === 1 && !step1Valid}
                className="gap-2 h-11 px-6 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
              >
                {t("onboardingNext")}
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={handleFinish}
                disabled={saving}
                className="gap-2 h-11 px-6 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {saving ? t("optionsSaving") : t("onboardingFinish")}
              </Button>
            )}
          </CardFooter>
        </Card>
      </motion.div>
    </div>
  );
}

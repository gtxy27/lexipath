import React, { useEffect, useMemo, useState } from "react";
import browser from "webextension-polyfill";
import {
  CEFRLevelSchema,
  JLPTLevelSchema,
  TOPIKLevelSchema,
  SupportedLanguageSchema,
  type CEFRLevel,
  type JLPTLevel,
  type TOPIKLevel,
  type SupportedLanguage,
  type Theme,
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
import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Globe,
  Video,
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useApplyTheme } from "../lib/theme";
import { motion, AnimatePresence } from "framer-motion";

const log = createLogger("ui:Onboarding");

type ProficiencyLevel = CEFRLevel | JLPTLevel | TOPIKLevel;

type OnboardingFormData = {
  targetLanguage: SupportedLanguage;
  proficiencyLevel: ProficiencyLevel;
  scenesEnabled: {
    webNative: boolean;
    webTarget: boolean;
    videoNative: boolean;
    videoTarget: boolean;
  };
};

function t(key: string, substitutions?: string | string[]): string {
  const message =
    substitutions === undefined
      ? browser.i18n.getMessage(key)
      : browser.i18n.getMessage(key, substitutions);
  return message || key;
}

function getProficiencyOptions(
  language: SupportedLanguage,
): Array<{ value: ProficiencyLevel; labelKey: string }> {
  if (language === "ja") {
    return JLPTLevelSchema.options.map((value) => ({
      value,
      labelKey: `proficiency_${value}`,
    }));
  } else if (language === "ko") {
    return TOPIKLevelSchema.options.map((value) => ({
      value: `${value}` as TOPIKLevel,
      labelKey: `proficiency_TOPIK${value}`,
    }));
  } else {
    return CEFRLevelSchema.options.map((value) => ({
      value,
      labelKey: `proficiency_${value}`,
    }));
  }
}

function getDefaultProficiency(language: SupportedLanguage): ProficiencyLevel {
  if (language === "ja") return "N3";
  if (language === "ko") return "3";
  return "B1";
}

function toCEFRLevel(
  proficiency: ProficiencyLevel,
  language: SupportedLanguage,
): CEFRLevel {
  if (language === "ja") {
    const mapping: Record<JLPTLevel, CEFRLevel> = {
      N5: "A1",
      N4: "A2",
      N3: "B1",
      N2: "B2",
      N1: "C1",
    };
    return mapping[proficiency as JLPTLevel];
  } else if (language === "ko") {
    const mapping: Record<TOPIKLevel, CEFRLevel> = {
      "1": "A1",
      "2": "A2",
      "3": "B1",
      "4": "B2",
      "5": "C1",
      "6": "C2",
    };
    return mapping[proficiency as TOPIKLevel];
  }
  return proficiency as CEFRLevel;
}

export function Onboarding(): React.ReactElement {
  const [currentStep, setCurrentStep] = useState(1);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [formData, setFormData] = useState<OnboardingFormData>({
    targetLanguage: "en",
    proficiencyLevel: "B1",
    scenesEnabled: {
      webNative: true,
      webTarget: true,
      videoNative: true,
      videoTarget: true,
    },
  });
  const [saving, setSaving] = useState(false);

  useApplyTheme(theme);

  useEffect(() => {
    async function loadTheme() {
      try {
        const response = await sendMessage("GET_SETTINGS", undefined);
        if (response.ok) {
          setTheme(response.value.theme);
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

  const proficiencyOptions = useMemo(
    () => getProficiencyOptions(formData.targetLanguage),
    [formData.targetLanguage],
  );

  function handleTargetLanguageChange(newLanguage: SupportedLanguage) {
    const oldLanguage = formData.targetLanguage;
    const currentLevel = formData.proficiencyLevel;

    let newProficiencyLevel = currentLevel;

    const oldIsJapanese = oldLanguage === "ja";
    const newIsJapanese = newLanguage === "ja";
    const oldIsKorean = oldLanguage === "ko";
    const newIsKorean = newLanguage === "ko";

    if (
      (oldIsJapanese && !newIsJapanese) ||
      (!oldIsJapanese && newIsJapanese) ||
      (oldIsKorean && !newIsKorean) ||
      (!oldIsKorean && newIsKorean)
    ) {
      newProficiencyLevel = getDefaultProficiency(newLanguage);
    }

    setFormData({
      ...formData,
      targetLanguage: newLanguage,
      proficiencyLevel: newProficiencyLevel,
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
      const cefrLevel = toCEFRLevel(
        formData.proficiencyLevel,
        formData.targetLanguage,
      );
      await sendMessage("SET_SETTINGS", {
        targetLanguage: formData.targetLanguage,
        proficiencyLevel: cefrLevel,
      });

      globalThis.close?.();
    } catch (error) {
      log.error("Failed to save onboarding settings", { message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  const progress = (currentStep / 3) * 100;

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
                <img src="../../icons/icon.svg" className="h-9 w-9" alt={t("extensionName")} />
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
               <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">{Math.round(progress)}% Complete</span>
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
                          {t("onboardingProficiencyLabel")}
                        </Label>
                        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                          {proficiencyOptions.map((option) => (
                            <Button
                              key={option.value}
                              variant="outline"
                              className={cn(
                                "h-11 rounded-xl border-gray-100 dark:border-white/5 transition-all",
                                formData.proficiencyLevel === option.value
                                  ? "bg-indigo-600 text-white border-indigo-500 shadow-lg shadow-indigo-600/10"
                                  : "bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400"
                              )}
                              onClick={() =>
                                setFormData({
                                  ...formData,
                                  proficiencyLevel: option.value,
                                })
                              }
                            >
                              <span className="font-black text-xs">
                                {t(option.labelKey).replace("Proficiency ", "").replace("JLPT ", "").replace("Level ", "")}
                              </span>
                            </Button>
                          ))}
                        </div>
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[
                        {
                          key: "webNative",
                          icon: Globe,
                          title: t("onboardingSceneWebNativeTitle"),
                          desc: t("onboardingSceneWebNativeDesc"),
                        },
                        {
                          key: "webTarget",
                          icon: Sparkles,
                          title: t("onboardingSceneWebTargetTitle"),
                          desc: t("onboardingSceneWebTargetDesc"),
                        },
                        {
                          key: "videoNative",
                          icon: Video,
                          title: t("onboardingSceneVideoNativeTitle"),
                          desc: t("onboardingSceneVideoNativeDesc"),
                        },
                        {
                          key: "videoTarget",
                          icon: Zap,
                          title: t("onboardingSceneVideoTargetTitle"),
                          desc: t("onboardingSceneVideoTargetDesc"),
                        },
                      ].map((scene) => (
                        <div key={scene.key} className={cn(
                          "relative group rounded-2xl border transition-all duration-300 p-5 cursor-pointer select-none",
                          formData.scenesEnabled[scene.key as keyof typeof formData.scenesEnabled]
                            ? "bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500/30"
                            : "bg-gray-50 dark:bg-white/5 border-gray-100 dark:border-white/5 hover:border-gray-200 dark:hover:border-white/10"
                        )}
                        onClick={() => setFormData({
                          ...formData,
                          scenesEnabled: {
                            ...formData.scenesEnabled,
                            [scene.key]: !formData.scenesEnabled[scene.key as keyof typeof formData.scenesEnabled],
                          },
                        })}>
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-start gap-4">
                              <div className={cn(
                                "p-3 rounded-xl transition-colors",
                                formData.scenesEnabled[scene.key as keyof typeof formData.scenesEnabled]
                                  ? "bg-indigo-500 text-white"
                                  : "bg-white dark:bg-[#0d0e14] text-gray-300 dark:text-gray-600"
                              )}>
                                <scene.icon className="h-6 w-6" />
                              </div>
                              <div className="space-y-1">
                                <h3 className="font-bold text-gray-900 dark:text-white tracking-tight">
                                  {scene.title}
                                </h3>
                                <p className="text-[10px] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider leading-tight">{scene.desc}</p>
                              </div>
                            </div>
                            <Switch
                              checked={formData.scenesEnabled[scene.key as keyof typeof formData.scenesEnabled]}
                              className="data-[state=checked]:bg-indigo-600"
                              aria-label={scene.title}
                              onCheckedChange={() => {}} // Controlled by card click
                            />
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
                          <CardContent className="p-10 grid grid-cols-2 gap-8 text-center relative">
                            <div className="space-y-3">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500 dark:text-indigo-400/70">
                                {t("onboardingSummaryTargetLanguage")}
                              </p>
                              <p data-testid="summary-target-lang" className="text-3xl font-black text-gray-900 dark:text-white tracking-tighter">
                                {t(`languageTarget_${formData.targetLanguage}`)}
                              </p>
                            </div>
                            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-12 w-px bg-gray-200 dark:bg-white/5" />
                            <div className="space-y-3">
                              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-500 dark:text-purple-400/70">
                                {t("onboardingSummaryProficiency")}
                              </p>
                              <p data-testid="summary-proficiency" className="text-3xl font-black text-gray-900 dark:text-white tracking-tighter">
                                {t(`proficiency_${formData.proficiencyLevel}`).replace("Proficiency ", "")}
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

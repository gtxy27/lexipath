import React, { useState, useMemo } from "react";
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
} from "@lexipath/core";
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
import { Progress } from "../components/ui/progress";
import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Globe,
  Video,
} from "lucide-react";
import { cn } from "../lib/utils";

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
  const message = browser.i18n.getMessage(key, substitutions);
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

    // Determine if we need to reset proficiency level
    let newProficiencyLevel = currentLevel;

    // Check if switching between different proficiency systems
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
      // Switching between different proficiency systems, reset to default
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

      // Close onboarding page and open options or popup
      window.close();
    } catch (error) {
      console.error("[LexiPath] Failed to save onboarding settings:", error);
    } finally {
      setSaving(false);
    }
  }

  const progress = (currentStep / 3) * 100;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
      <Card className="w-full max-w-2xl shadow-lg">
        <CardHeader className="text-center pb-2 border-b">
          <CardTitle className="text-3xl font-bold text-gray-900">
            {browser.i18n.getMessage("welcomeTitle")}
          </CardTitle>
          <CardDescription className="text-lg text-gray-500">
            {browser.i18n.getMessage("welcomeDesc")}
          </CardDescription>
        </CardHeader>

        <div className="px-6 py-4 border-b">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-center text-gray-500 mt-2">
            {t("onboardingStepProgress", String(currentStep))}
          </p>
        </div>

        <CardContent className="p-6 min-h-[400px]">
          {currentStep === 1 && (
            <div className="space-y-8">
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold mb-2">
                  {t("onboardingStep1Title")}
                </h2>
                <p className="text-gray-500">{t("onboardingStep1Desc")}</p>
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <Label className="text-base">
                    {t("onboardingTargetLanguageLabel")}
                  </Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {targetLanguageOptions.map((option) => (
                      <Button
                        key={option.value}
                        variant={
                          formData.targetLanguage === option.value
                            ? "default"
                            : "outline"
                        }
                        className={cn(
                          "h-auto py-3 justify-start px-4",
                          formData.targetLanguage === option.value &&
                            "bg-indigo-600 hover:bg-indigo-700",
                        )}
                        onClick={() => handleTargetLanguageChange(option.value)}
                      >
                        <div className="flex items-center gap-2 w-full">
                          <span className="flex-1 text-left">
                            {t(option.labelKey)}
                          </span>
                          {formData.targetLanguage === option.value && (
                            <Check className="h-4 w-4" />
                          )}
                        </div>
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <Label className="text-base">
                    {t("onboardingProficiencyLabel")}
                  </Label>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                    {proficiencyOptions.map((option) => (
                      <Button
                        key={option.value}
                        variant={
                          formData.proficiencyLevel === option.value
                            ? "default"
                            : "outline"
                        }
                        className={cn(
                          "h-auto py-2 px-2",
                          formData.proficiencyLevel === option.value &&
                            "bg-indigo-600 hover:bg-indigo-700",
                        )}
                        onClick={() =>
                          setFormData({
                            ...formData,
                            proficiencyLevel: option.value,
                          })
                        }
                      >
                        {t(option.labelKey).replace("Proficiency ", "")}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold mb-2">
                  {t("onboardingStep2Title")}
                </h2>
                <p className="text-gray-500">{t("onboardingStep2Desc")}</p>
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
                    icon: Globe,
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
                    icon: Video,
                    title: t("onboardingSceneVideoTargetTitle"),
                    desc: t("onboardingSceneVideoTargetDesc"),
                  },
                ].map((scene) => (
                  <Card key={scene.key} className="border shadow-sm">
                    <CardContent className="p-4 flex items-center justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-full bg-indigo-100 text-indigo-600">
                          <scene.icon className="h-5 w-5" />
                        </div>
                        <div className="space-y-1">
                          <h3 className="font-medium leading-none">
                            {scene.title}
                          </h3>
                          <p className="text-sm text-gray-500">{scene.desc}</p>
                        </div>
                      </div>
                      <Switch
                        checked={
                          formData.scenesEnabled[
                            scene.key as keyof typeof formData.scenesEnabled
                          ]
                        }
                        aria-label={scene.title}
                        onCheckedChange={(checked) =>
                          setFormData({
                            ...formData,
                            scenesEnabled: {
                              ...formData.scenesEnabled,
                              [scene.key]: checked,
                            },
                          })
                        }
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-8">
              <div className="text-center mb-6">
                <h2 className="text-xl font-semibold mb-2">
                  {t("onboardingStep3Title")}
                </h2>
                <p className="text-gray-500">{t("onboardingStep3Desc")}</p>
              </div>

              <Card className="bg-gray-50 border border-dashed">
                <CardContent className="p-6 grid grid-cols-2 gap-8 text-center">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-500">
                      {t("onboardingSummaryTargetLanguage")}
                    </p>
                    <p className="text-2xl font-bold text-indigo-600">
                      {t(`languageTarget_${formData.targetLanguage}`)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-500">
                      {t("onboardingSummaryProficiency")}
                    </p>
                    <p className="text-2xl font-bold text-indigo-600">
                      {t(`proficiency_${formData.proficiencyLevel}`)}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <p className="text-sm text-center text-gray-500 max-w-sm mx-auto">
                {t("onboardingSummaryNote")}
              </p>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex justify-between p-6 pt-0 border-t">
          <Button
            variant="ghost"
            onClick={handlePrevious}
            disabled={currentStep === 1}
            className="gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("onboardingPrevious")}
          </Button>

          {currentStep < 3 ? (
            <Button
              onClick={handleNext}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700"
            >
              {t("onboardingNext")}
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleFinish}
              disabled={saving}
              className="gap-2 bg-indigo-600 hover:bg-indigo-700"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? t("optionsSaving") : t("onboardingFinish")}
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

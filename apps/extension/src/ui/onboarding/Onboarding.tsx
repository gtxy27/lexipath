import React, { useState, useMemo } from 'react';
import browser from 'webextension-polyfill';
import {
  CEFRLevelSchema,
  JLPTLevelSchema,
  TOPIKLevelSchema,
  SupportedLanguageSchema,
  type CEFRLevel,
  type JLPTLevel,
  type TOPIKLevel,
  type SupportedLanguage,
} from '@lexipath/core';
import { sendMessage } from '../../shared/messages';

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

function getProficiencyOptions(language: SupportedLanguage): Array<{ value: ProficiencyLevel; labelKey: string }> {
  if (language === 'ja') {
    return JLPTLevelSchema.options.map((value) => ({
      value,
      labelKey: `proficiency_${value}`,
    }));
  } else if (language === 'ko') {
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
  if (language === 'ja') return 'N3';
  if (language === 'ko') return '3';
  return 'B1';
}

function toCEFRLevel(proficiency: ProficiencyLevel, language: SupportedLanguage): CEFRLevel {
  if (language === 'ja') {
    const mapping: Record<JLPTLevel, CEFRLevel> = {
      'N5': 'A1',
      'N4': 'A2',
      'N3': 'B1',
      'N2': 'B2',
      'N1': 'C1',
    };
    return mapping[proficiency as JLPTLevel];
  } else if (language === 'ko') {
    const mapping: Record<TOPIKLevel, CEFRLevel> = {
      '1': 'A1',
      '2': 'A2',
      '3': 'B1',
      '4': 'B2',
      '5': 'C1',
      '6': 'C2',
    };
    return mapping[proficiency as TOPIKLevel];
  }
  return proficiency as CEFRLevel;
}

function ProgressIndicator({ currentStep }: { currentStep: number }): React.ReactElement {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-center gap-2 mb-2">
        {[1, 2, 3].map((step) => (
          <div
            key={step}
            className={`h-2 rounded-full transition-all ${
              step === currentStep
                ? 'w-8 bg-primary-500'
                : step < currentStep
                ? 'w-2 bg-primary-300'
                : 'w-2 bg-gray-200'
            }`}
          />
        ))}
      </div>
      <p className="text-sm text-gray-500 text-center">
        {t('onboardingStepProgress', String(currentStep))}
      </p>
    </div>
  );
}

function OptionCard({
  title,
  description,
  selected,
  onClick,
}: {
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full p-4 rounded-lg border-2 text-left transition-all ${
        selected
          ? 'border-primary-500 bg-primary-50'
          : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
            selected ? 'border-primary-500 bg-primary-500' : 'border-gray-300'
          }`}
        >
          {selected && <div className="w-2 h-2 bg-white rounded-full" />}
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
      </div>
    </button>
  );
}

function SceneCard({
  title,
  description,
  enabled,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <div
      className={`p-4 rounded-lg border-2 transition-all ${
        enabled
          ? 'border-primary-500 bg-primary-50'
          : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onToggle}
          className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
            enabled ? 'border-primary-500 bg-primary-500' : 'border-gray-300'
          }`}
        >
          {enabled && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </button>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 mb-1">{title}</h3>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
      </div>
    </div>
  );
}

export function Onboarding(): React.ReactElement {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<OnboardingFormData>({
    targetLanguage: 'en',
    proficiencyLevel: 'B1',
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
    []
  );

  const proficiencyOptions = useMemo(
    () => getProficiencyOptions(formData.targetLanguage),
    [formData.targetLanguage]
  );

  function handleTargetLanguageChange(newLanguage: SupportedLanguage) {
    const oldLanguage = formData.targetLanguage;
    const currentLevel = formData.proficiencyLevel;

    // Determine if we need to reset proficiency level
    let newProficiencyLevel = currentLevel;

    // Check if switching between different proficiency systems
    const oldIsJapanese = oldLanguage === 'ja';
    const newIsJapanese = newLanguage === 'ja';
    const oldIsKorean = oldLanguage === 'ko';
    const newIsKorean = newLanguage === 'ko';

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
      const cefrLevel = toCEFRLevel(formData.proficiencyLevel, formData.targetLanguage);
      await sendMessage('SET_SETTINGS', {
        targetLanguage: formData.targetLanguage,
        proficiencyLevel: cefrLevel,
      });

      // Close onboarding page and open options or popup
      window.close();
    } catch (error) {
      console.error('[LexiPath] Failed to save onboarding settings:', error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-gray-50">
      <div className="max-w-2xl w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">
            {browser.i18n.getMessage('welcomeTitle')}
          </h1>
          <p className="text-gray-600">
            {browser.i18n.getMessage('welcomeDesc')}
          </p>
        </div>

        {/* Progress Indicator */}
        <ProgressIndicator currentStep={currentStep} />

        {/* Step Content */}
        <div className="bg-white rounded-xl shadow-lg p-8 mb-6">
          {currentStep === 1 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">
                {t('onboardingStep1Title')}
              </h2>
              <p className="text-gray-600 mb-6">
                {t('onboardingStep1Desc')}
              </p>

              <div className="space-y-6">
                {/* Target Language Selection */}
                <div>
                  <label className="block text-sm font-medium mb-3">
                    {t('onboardingTargetLanguageLabel')}
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {targetLanguageOptions.map((option) => (
                      <OptionCard
                        key={option.value}
                        title={t(option.labelKey)}
                        description=""
                        selected={formData.targetLanguage === option.value}
                        onClick={() => handleTargetLanguageChange(option.value)}
                      />
                    ))}
                  </div>
                </div>

                {/* Proficiency Level Selection */}
                <div>
                  <label className="block text-sm font-medium mb-3">
                    {t('onboardingProficiencyLabel')}
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {proficiencyOptions.map((option) => (
                      <OptionCard
                        key={option.value}
                        title={t(option.labelKey)}
                        description=""
                        selected={formData.proficiencyLevel === option.value}
                        onClick={() =>
                          setFormData({ ...formData, proficiencyLevel: option.value })
                        }
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">
                {t('onboardingStep2Title')}
              </h2>
              <p className="text-gray-600 mb-6">
                {t('onboardingStep2Desc')}
              </p>

              <div className="space-y-4">
                <SceneCard
                  title={t('onboardingSceneWebNativeTitle')}
                  description={t('onboardingSceneWebNativeDesc')}
                  enabled={formData.scenesEnabled.webNative}
                  onToggle={() =>
                    setFormData({
                      ...formData,
                      scenesEnabled: {
                        ...formData.scenesEnabled,
                        webNative: !formData.scenesEnabled.webNative,
                      },
                    })
                  }
                />
                <SceneCard
                  title={t('onboardingSceneWebTargetTitle')}
                  description={t('onboardingSceneWebTargetDesc')}
                  enabled={formData.scenesEnabled.webTarget}
                  onToggle={() =>
                    setFormData({
                      ...formData,
                      scenesEnabled: {
                        ...formData.scenesEnabled,
                        webTarget: !formData.scenesEnabled.webTarget,
                      },
                    })
                  }
                />
                <SceneCard
                  title={t('onboardingSceneVideoNativeTitle')}
                  description={t('onboardingSceneVideoNativeDesc')}
                  enabled={formData.scenesEnabled.videoNative}
                  onToggle={() =>
                    setFormData({
                      ...formData,
                      scenesEnabled: {
                        ...formData.scenesEnabled,
                        videoNative: !formData.scenesEnabled.videoNative,
                      },
                    })
                  }
                />
                <SceneCard
                  title={t('onboardingSceneVideoTargetTitle')}
                  description={t('onboardingSceneVideoTargetDesc')}
                  enabled={formData.scenesEnabled.videoTarget}
                  onToggle={() =>
                    setFormData({
                      ...formData,
                      scenesEnabled: {
                        ...formData.scenesEnabled,
                        videoTarget: !formData.scenesEnabled.videoTarget,
                      },
                    })
                  }
                />
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div>
              <h2 className="text-2xl font-bold mb-2">
                {t('onboardingStep3Title')}
              </h2>
              <p className="text-gray-600 mb-6">
                {t('onboardingStep3Desc')}
              </p>

              <div className="bg-gray-50 rounded-lg p-6 space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">
                    {t('onboardingSummaryTargetLanguage')}
                  </h3>
                  <p className="text-lg font-semibold">
                    {t(`languageTarget_${formData.targetLanguage}`)}
                  </p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">
                    {t('onboardingSummaryProficiency')}
                  </h3>
                  <p className="text-lg font-semibold">
                    {t(`proficiency_${formData.proficiencyLevel}`)}
                  </p>
                </div>
              </div>

              <p className="text-sm text-gray-500 mt-6 text-center">
                {t('onboardingSummaryNote')}
              </p>
            </div>
          )}
        </div>

        {/* Navigation Buttons */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={currentStep === 1}
            className={`px-6 py-3 rounded-lg font-semibold transition-all ${
              currentStep === 1
                ? 'text-gray-400 cursor-not-allowed'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {t('onboardingPrevious')}
          </button>

          {currentStep < 3 ? (
            <button
              type="button"
              onClick={handleNext}
              className="px-6 py-3 rounded-lg font-semibold bg-primary-500 text-white hover:bg-primary-600 transition-all"
            >
              {t('onboardingNext')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={saving}
              className={`px-6 py-3 rounded-lg font-semibold transition-all ${
                saving
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-primary-500 text-white hover:bg-primary-600'
              }`}
            >
              {saving ? t('optionsSaving') : t('onboardingFinish')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import type { CEFRLevel, ProficiencyPreference, SupportedLanguage, NativeLanguage } from '@lexipath/core';

function formatProficiencyPreferenceValue(preference: ProficiencyPreference): string {
  if (preference.standard === 'CET-4' || preference.standard === 'CET-6') {
    if (preference.value === 'pass') return '通过';
  }
  return preference.value;
}

export function buildProficiencyReferenceLine(options: {
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  userLevel: CEFRLevel;
  proficiencyPreference?: ProficiencyPreference;
}): string {
  if (!options.proficiencyPreference) return '';
  const standard = options.proficiencyPreference.standard;
  const value = formatProficiencyPreferenceValue(options.proficiencyPreference);
  return `参考：${standard} ${value}（≈ CEFR ${options.userLevel}）`;
}

export function buildProficiencyRangeReferenceLine(options: {
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  difficultyMin: CEFRLevel;
  difficultyMax: CEFRLevel;
  proficiencyPreference?: ProficiencyPreference;
}): string {
  if (!options.proficiencyPreference) return '';
  // Range prompts still use CEFR internally, so only attach the user's chosen scale once.
  return buildProficiencyReferenceLine({
    sourceLang: options.sourceLang,
    targetLang: options.targetLang,
    userLevel: options.difficultyMax,
    ...(options.proficiencyPreference
      ? { proficiencyPreference: options.proficiencyPreference }
      : {}),
  });
}

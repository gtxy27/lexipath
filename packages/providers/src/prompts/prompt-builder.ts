import {
  BEHAVIORS,
  resolvePromptScene,
  resolvePromptStyleKey,
  resolvePromptStyleValue,
  type CEFRLevel,
  type NativeLanguage,
  type PromptStyleKey,
  type PromptUserInfo,
  type Settings,
  type SupportedLanguage,
} from '@lexipath/core';
import { buildProficiencyRangeReferenceLine, buildProficiencyReferenceLine } from './proficiency-reference';
import { buildEnglishCorrectionPrompt } from './english-correction-prompt';
import { buildExplainWordPrompt } from './explain-word-prompt';
import { buildKeywordSelectPrompt } from './keyword-select-prompt';
import { buildSubtitleAdaptPrompt } from './subtitle-adapt-prompt';
import { buildSubtitleEnhancePrompt } from './subtitle-enhance-prompt';
import { buildTermTranslatePrompt } from './term-translate-prompt';
import { buildTranslateKeywordsPrompt } from './translate-keywords-prompt';
import { buildWebEnhancePrompt } from './web-enhance-prompt';

type GetSettings = () => Promise<Settings>;

function pickStyleKey(explicit: unknown, settingsKey: Settings['promptStyle']): PromptStyleKey {
  if (explicit !== undefined && explicit !== null && String(explicit).trim()) {
    const parsed = resolvePromptStyleKey(explicit);
    return parsed;
  }
  if (settingsKey) return settingsKey;
  return 'default';
}

function makeUserInfo(options: {
  motherTongue: NativeLanguage;
  targetLearningLanguage: SupportedLanguage;
  cefrLevel: CEFRLevel;
  levelReferenceLine?: string;
}): PromptUserInfo {
  return {
    motherTongue: options.motherTongue,
    targetLearningLanguage: options.targetLearningLanguage,
    cefrLevel: options.cefrLevel,
    ...(options.levelReferenceLine ? { levelReferenceLine: options.levelReferenceLine } : {}),
  };
}

export class PromptBuilder {
  private readonly getSettings: GetSettings;

  constructor(options: { getSettings: GetSettings }) {
    this.getSettings = options.getSettings;
  }

  async buildSubtitleEnhancePrompt(options: {
    subtitle: string;
    sourceLang: SupportedLanguage;
    targetLang: NativeLanguage;
    difficultyLevel: CEFRLevel;
    mode: 'single' | 'bilingual';
    sceneKey?: string;
    styleKey?: unknown;
  }): Promise<string> {
    const settings = await this.getSettings();
    const sceneValue = resolvePromptScene(options.sceneKey ?? 'video_subtitle_enhance');
    const styleValue = resolvePromptStyleValue(pickStyleKey(options.styleKey, settings.promptStyle));

    const referenceLine = buildProficiencyReferenceLine({
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      userLevel: options.difficultyLevel,
      ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
    });

    const userInfo = makeUserInfo({
      motherTongue: options.targetLang,
      targetLearningLanguage: options.sourceLang,
      cefrLevel: options.difficultyLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    });

    return buildSubtitleEnhancePrompt({
      subtitle: options.subtitle,
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      difficultyLevel: options.difficultyLevel,
      mode: options.mode,
      sceneValue,
      styleValue,
      userInfo,
      behavior: BEHAVIORS.subtitle_enhance,
    });
  }

  async buildSubtitleAdaptPrompt(options: {
    subtitle: string;
    sourceLang: SupportedLanguage;
    targetLang: SupportedLanguage;
    difficultyLevel: CEFRLevel;
    sceneKey?: string;
    styleKey?: unknown;
  }): Promise<string> {
    const settings = await this.getSettings();
    const motherTongue = settings.nativeLanguage;
    const sceneValue = resolvePromptScene(options.sceneKey ?? 'video_subtitle');
    const styleValue = resolvePromptStyleValue(pickStyleKey(options.styleKey, settings.promptStyle));

    const referenceLine = buildProficiencyReferenceLine({
      sourceLang: options.targetLang,
      targetLang: motherTongue,
      userLevel: options.difficultyLevel,
      ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
    });

    const userInfo = makeUserInfo({
      motherTongue,
      targetLearningLanguage: options.targetLang,
      cefrLevel: options.difficultyLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    });

    return buildSubtitleAdaptPrompt({
      subtitle: options.subtitle,
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      difficultyLevel: options.difficultyLevel,
      sceneValue,
      styleValue,
      userInfo,
      behavior: BEHAVIORS.subtitle_adapt,
    });
  }

  async buildExplainWordPrompt(options: {
    word: string;
    context?: string;
    sourceLang: SupportedLanguage;
    targetLang: NativeLanguage;
    userLevel: CEFRLevel;
    sceneKey?: string;
    styleKey?: unknown;
  }): Promise<string> {
    const settings = await this.getSettings();
    const sceneValue = resolvePromptScene(options.sceneKey ?? 'word_card');
    const styleValue = resolvePromptStyleValue(pickStyleKey(options.styleKey, settings.promptStyle));

    const referenceLine = buildProficiencyReferenceLine({
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      userLevel: options.userLevel,
      ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
    });

    const userInfo = makeUserInfo({
      motherTongue: options.targetLang,
      targetLearningLanguage: options.sourceLang,
      cefrLevel: options.userLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    });

    return buildExplainWordPrompt({
      word: options.word,
      ...(options.context !== undefined ? { context: options.context } : {}),
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      userLevel: options.userLevel,
      sceneValue,
      styleValue,
      userInfo,
      behavior: BEHAVIORS.explain_word,
    });
  }

  async buildKeywordSelectPrompt(options: {
    text: string;
    sourceLang: SupportedLanguage;
    targetLang: NativeLanguage;
    userLevel: CEFRLevel;
    scene?: 'subtitle' | 'web';
    styleKey?: unknown;
  }): Promise<string> {
    const settings = await this.getSettings();
    const sceneValue = resolvePromptScene(options.scene === 'web' ? 'keyword_select_web' : 'keyword_select_subtitle');
    const styleValue = resolvePromptStyleValue(pickStyleKey(options.styleKey, settings.promptStyle));

    const referenceLine = buildProficiencyReferenceLine({
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      userLevel: options.userLevel,
      ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
    });

    const userInfo = makeUserInfo({
      motherTongue: options.targetLang,
      targetLearningLanguage: options.sourceLang,
      cefrLevel: options.userLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    });

    return buildKeywordSelectPrompt({
      text: options.text,
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      userLevel: options.userLevel,
      sceneValue,
      styleValue,
      userInfo,
      behavior: BEHAVIORS.keyword_select,
    });
  }

  async buildWebEnhancePrompt(options: {
    content: string;
    sourceLang: SupportedLanguage;
    targetLang: NativeLanguage;
    difficultyMin: CEFRLevel;
    difficultyMax: CEFRLevel;
    maxWords?: number;
    sceneKey?: string;
    styleKey?: unknown;
  }): Promise<string> {
    const settings = await this.getSettings();
    const sceneValue = resolvePromptScene(options.sceneKey ?? 'web_content');
    const styleValue = resolvePromptStyleValue(pickStyleKey(options.styleKey, settings.promptStyle));

    const referenceLine = buildProficiencyRangeReferenceLine({
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      difficultyMin: options.difficultyMin,
      difficultyMax: options.difficultyMax,
      ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
    });

    const userInfo = makeUserInfo({
      motherTongue: options.targetLang,
      targetLearningLanguage: options.sourceLang,
      cefrLevel: options.difficultyMax,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    });

    return buildWebEnhancePrompt({
      content: options.content,
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      difficultyMin: options.difficultyMin,
      difficultyMax: options.difficultyMax,
      ...(options.maxWords !== undefined ? { maxWords: options.maxWords } : {}),
      sceneValue,
      styleValue,
      userInfo,
      behavior: BEHAVIORS.web_enhance,
    });
  }

  async buildTranslateKeywordsPrompt(options: {
    keywords: string[];
    context?: string;
    sourceLang: SupportedLanguage;
    targetLang: NativeLanguage;
    userLevel: CEFRLevel;
    sceneKey?: string;
    styleKey?: unknown;
  }): Promise<string> {
    const settings = await this.getSettings();
    const sceneValue = resolvePromptScene(options.sceneKey ?? 'keyword_translate');
    const styleValue = resolvePromptStyleValue(pickStyleKey(options.styleKey, settings.promptStyle));

    const referenceLine = buildProficiencyReferenceLine({
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      userLevel: options.userLevel,
      ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
    });

    const userInfo = makeUserInfo({
      motherTongue: options.targetLang,
      targetLearningLanguage: options.sourceLang,
      cefrLevel: options.userLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    });

    return buildTranslateKeywordsPrompt({
      keywords: options.keywords,
      ...(options.context !== undefined ? { context: options.context } : {}),
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      userLevel: options.userLevel,
      sceneValue,
      styleValue,
      userInfo,
      behavior: BEHAVIORS.translate_keywords,
    });
  }

  async buildTermTranslatePrompt(options: {
    terms: string[];
    sourceLang: SupportedLanguage;
    targetLang: NativeLanguage;
    userLevel: CEFRLevel;
    sceneKey?: string;
    styleKey?: unknown;
  }): Promise<string> {
    const settings = await this.getSettings();
    const sceneValue = resolvePromptScene(options.sceneKey ?? 'term_translate');
    const styleValue = resolvePromptStyleValue(pickStyleKey(options.styleKey, settings.promptStyle));

    const referenceLine = buildProficiencyReferenceLine({
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      userLevel: options.userLevel,
      ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
    });

    const userInfo = makeUserInfo({
      motherTongue: options.targetLang,
      targetLearningLanguage: options.sourceLang,
      cefrLevel: options.userLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    });

    return buildTermTranslatePrompt({
      terms: options.terms,
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      userLevel: options.userLevel,
      sceneValue,
      styleValue,
      userInfo,
      behavior: BEHAVIORS.term_translate,
    });
  }

  async buildEnglishCorrectionPrompt(options: { text: string; sceneKey?: string; styleKey?: unknown }): Promise<string> {
    const settings = await this.getSettings();
    const sceneValue = resolvePromptScene(options.sceneKey ?? 'english_correction');
    const styleValue = resolvePromptStyleValue(pickStyleKey(options.styleKey, settings.promptStyle));

    const referenceLine = buildProficiencyReferenceLine({
      sourceLang: settings.targetLanguage,
      targetLang: settings.nativeLanguage,
      userLevel: settings.proficiencyLevel,
      ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
    });

    const userInfo = makeUserInfo({
      motherTongue: settings.nativeLanguage,
      targetLearningLanguage: settings.targetLanguage,
      cefrLevel: settings.proficiencyLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    });

    return buildEnglishCorrectionPrompt({
      text: options.text,
      sceneValue,
      styleValue,
      userInfo,
      behavior: BEHAVIORS.english_correction,
    });
  }
}

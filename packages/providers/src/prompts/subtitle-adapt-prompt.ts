import { BEHAVIORS, type CEFRLevel, type PromptTemplateInput, type PromptUserInfo, type SupportedLanguage } from '@lexipath/core';
import { buildCefrOutputGuidance } from './cefr-guidance';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface SubtitleAdaptPromptOptions {
  subtitle: string;
  sourceLang: SupportedLanguage;
  targetLang: SupportedLanguage;
  difficultyLevel: CEFRLevel;
  sceneValue: string;
  styleValue: string;
  userInfo: PromptUserInfo;
  behavior: typeof BEHAVIORS.subtitle_adapt;
}

export function buildSubtitleAdaptPrompt(options: SubtitleAdaptPromptOptions): string {
  const subtitle = options.subtitle.trim();
  const cefrGuidance = buildCefrOutputGuidance({
    sourceLang: options.sourceLang,
    targetLang: options.targetLang,
    level: options.difficultyLevel,
  });

  const template: PromptTemplateInput = {
    role: options.behavior.role,
    scene: options.sceneValue,
    style: options.styleValue,
    task: options.behavior.task({
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      difficultyLevel: options.difficultyLevel,
    }),
    userInfo: options.userInfo,
    userInput: subtitle,
    outputFormat: options.behavior.outputFormat({
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
      difficultyLevel: options.difficultyLevel,
      cefrGuidance,
    }),
    outputNotes: options.behavior.outputNotes({
      cefrGuidance,
      targetLang: options.targetLang,
      difficultyLevel: options.difficultyLevel,
    }),
  };

  return renderPromptTemplate(template);
}

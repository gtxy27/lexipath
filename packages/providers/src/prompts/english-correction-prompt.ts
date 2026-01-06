import { BEHAVIORS, type PromptTemplateInput, type PromptUserInfo } from '@lexipath/core';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface EnglishCorrectionPromptOptions {
  text: string;
  sceneValue: string;
  styleValue: string;
  userInfo: PromptUserInfo;
  behavior: typeof BEHAVIORS.english_correction;
}

export function buildEnglishCorrectionPrompt(options: EnglishCorrectionPromptOptions): string {
  const input = options.text.trim();

  const template: PromptTemplateInput = {
    role: options.behavior.role,
    scene: options.sceneValue,
    style: options.styleValue,
    task: options.behavior.task(),
    userInfo: options.userInfo,
    userInput: input,
    outputFormat: options.behavior.outputFormat({}),
    outputNotes: options.behavior.outputNotes({}),
  };

  return renderPromptTemplate(template);
}

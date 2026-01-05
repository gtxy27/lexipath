import type { CEFRLevel } from '../types';

export type PromptUserInfo = {
  motherTongue: string;
  targetLearningLanguage: string;
  cefrLevel: CEFRLevel;
  levelReferenceLine?: string | undefined;
};

export type PromptContextInfo = {
  before: string[];
  after: string[];
};

export type PromptTemplateInput = {
  // Top section (no tags; fixed order)
  role: string;
  scene: string;
  style: string;
  task: string;

  // Tagged information blocks
  userInfo: PromptUserInfo;
  contextInfo?: PromptContextInfo;
  userInput: string;
  outputFormat: string;
  outputNotes: string;
};

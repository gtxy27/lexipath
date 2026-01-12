import type { CEFRLevel, PromptStyleKey } from '../types';
import type { PromptSceneKey } from './scenes';

export type PromptUserInfo = {
  motherTongue: string;
  targetLearningLanguage: string;
  cefrLevel: CEFRLevel;
  levelReferenceLine?: string | undefined;
  targetLearningLanguageLevel?: CEFRLevel | undefined;
  targetLearningLanguageLevelReferenceLine?: string | undefined;
};

export type PromptContextInfo = {
  before: string[];
  after: string[];
};

/**
 * Canonical section order (as discussed).
 * Note: Role/Scene/(optional Style)/Task are rendered as a fixed top header (no tags).
 * The remaining sections are rendered as tagged blocks in this order.
 */
export const PROMPT_SECTION_ORDER = [
  'Role',
  'Scene',
  'Style',
  'Task',
  'UserInfo',
  'ContextInfo',
  'UserInput',
  'OutputFormat',
  'OutputNotes',
] as const;

export type PromptSectionKey = typeof PROMPT_SECTION_ORDER[number];

/**
 * The bound strings owned by an agent behavior.
 *
 * Note: `usesStyle` controls whether the global `styleKey` is rendered into the
 * prompt header. Most structured-output tasks should keep this disabled to
 * avoid "tone/style" instructions leaking into parsing-sensitive responses.
 */
export type PromptBehaviorSnapshot = {
  role: string;
  task: string;
  outputFormat: string;
  outputNotes: string;
  usesStyle?: boolean | undefined;
};

export type PromptAgentKey = string;

/**
 * External API (key-based):
 * - `agentKey`: string key → behavior snapshot mapping
 * - `sceneKey/styleKey`: keys resolved internally
 * - `userInfo/contextInfo/userInput`: runtime payload
 */
export type BuildPromptRequest = {
  agentKey: PromptAgentKey;
  sceneKey: PromptSceneKey | string;
  styleKey?: PromptStyleKey | string | undefined;
  userInfo: PromptUserInfo;
  contextInfo?: PromptContextInfo;
  userInput: string;
};

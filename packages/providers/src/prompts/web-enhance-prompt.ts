import { BEHAVIORS, type CEFRLevel, type NativeLanguage, type PromptTemplateInput, type PromptUserInfo, type SupportedLanguage } from '@lexipath/core';
import { buildCefrOutputGuidance } from './cefr-guidance';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface WebEnhancePromptOptions {
  content: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  difficultyMin: CEFRLevel;
  difficultyMax: CEFRLevel;
  maxWords?: number;
  sceneValue: string;
  styleValue: string;
  userInfo: PromptUserInfo;
  behavior: typeof BEHAVIORS.web_enhance;
}

/**
 * Build prompt for web content enhancement.
 * Based on VocabMeld's translation prompt design.
 *
 * The prompt instructs the LLM to:
 * 1. Select vocabulary within the specified CEFR difficulty range
 * 2. Translate selected words to the target language
 * 3. Provide CEFR difficulty levels for each word
 * 4. Output structured JSON format
 */
export function buildWebEnhancePrompt(options: WebEnhancePromptOptions): string {
  const {
    content,
    sourceLang,
    targetLang,
    difficultyMin,
    difficultyMax,
    maxWords = 15,
    sceneValue,
    styleValue,
    userInfo,
    behavior,
  } = options;

  const cefrGuidance = buildCefrOutputGuidance({
    sourceLang,
    targetLang,
    level: difficultyMax,
  });
  const behaviorParams = {
    sourceLang,
    targetLang,
    difficultyMin,
    difficultyMax,
    maxWords,
    cefrGuidance,
  };

  const template: PromptTemplateInput = {
    role: behavior.role,
    scene: sceneValue,
    style: styleValue,
    task: behavior.task({ sourceLang, targetLang, difficultyMin, difficultyMax, maxWords }),
    userInfo,
    userInput: content,
    outputFormat: behavior.outputFormat(behaviorParams),
    outputNotes: behavior.outputNotes(behaviorParams),
  };

  return renderPromptTemplate(template);
}

/**
 * Parse web enhancement response from LLM.
 * Handles both plain JSON and markdown code blocks.
 */
export function parseWebEnhanceResponse(responseText: string): {
  content_result: string;
  convert_word?: Array<{
    original: string;
    converted: string;
    difficulty?: string;
  }>;
} {
  try {
    let jsonStr = responseText.trim();

    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      jsonStr = jsonMatch[1].trim();
    }

    const data = JSON.parse(jsonStr);
    return data;
  } catch (error) {
    throw new Error(`Failed to parse web enhance response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

import { BEHAVIORS, type CEFRLevel, type NativeLanguage, type PromptTemplateInput, type PromptUserInfo, type SupportedLanguage } from '@lexipath/core';
import { buildCefrOutputGuidance } from './cefr-guidance';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface SubtitleEnhancePromptOptions {
  subtitle: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  difficultyLevel: CEFRLevel;
  mode: 'single' | 'bilingual';
  sceneValue: string;
  styleValue: string;
  userInfo: PromptUserInfo;
  behavior: typeof BEHAVIORS.subtitle_enhance;
}

/**
 * Build prompt for subtitle enhancement.
 *
 * The prompt instructs the LLM to:
 * 1. Simplify or enhance the subtitle based on difficulty level
 * 2. Maintain subtitle timing compatibility (keep length reasonable)
 * 3. Preserve meaning while adapting difficulty
 * 4. Output structured JSON with enhanced lines
 *
 * For single mode: line1_final contains enhanced target language subtitle
 * For bilingual mode: line1_final is enhanced, line2_final is native translation
 */
export function buildSubtitleEnhancePrompt(options: SubtitleEnhancePromptOptions): string {
  const {
    subtitle,
    sourceLang,
    targetLang,
    difficultyLevel,
    mode,
    sceneValue,
    styleValue,
    userInfo,
    behavior,
  } = options;

  const cefrGuidance = buildCefrOutputGuidance({
    sourceLang,
    targetLang,
    level: difficultyLevel,
  });

  const templateBase: Omit<PromptTemplateInput, 'outputFormat' | 'outputNotes'> = {
    role: behavior.role,
    scene: sceneValue,
    style: styleValue,
    task: behavior.task({ sourceLang, targetLang, difficultyLevel, mode }),
    userInfo,
    userInput: subtitle,
  };

  return renderPromptTemplate({
    ...templateBase,
    outputFormat: behavior.outputFormat({ mode }),
    outputNotes: behavior.outputNotes({ cefrGuidance, sourceLang, targetLang, difficultyLevel, mode }),
  });
}

/**
 * Parse subtitle enhancement response from LLM.
 * Handles both plain JSON and markdown code blocks.
 */
export function parseSubtitleEnhanceResponse(responseText: string): {
  line1_final: string;
  line2_final?: string;
  line3_final?: string;
} {
  try {
    let jsonStr = responseText.trim();

    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      jsonStr = jsonMatch[1].trim();
    }

    const data = JSON.parse(jsonStr);

    if (!data.line1_final) {
      throw new Error('Missing required field: line1_final');
    }

    return {
      line1_final: data.line1_final,
      line2_final: data.line2_final,
      line3_final: data.line3_final,
    };
  } catch (error) {
    throw new Error(`Failed to parse subtitle enhance response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

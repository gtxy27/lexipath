import type { CEFRLevel, SupportedLanguage, NativeLanguage } from '@lexipath/core';

export interface SubtitleEnhancePromptOptions {
  subtitle: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  difficultyLevel: CEFRLevel;
  mode: 'single' | 'bilingual';
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
  } = options;

  const sourceLanguageName = getLanguageName(sourceLang);
  const targetLanguageName = getLanguageName(targetLang);

  if (mode === 'single') {
    return `You are a subtitle enhancement assistant for language learners. Enhance the following ${sourceLanguageName} subtitle to match ${difficultyLevel} CEFR proficiency level.

Rules:
1. Adapt vocabulary and grammar to ${difficultyLevel} level
2. Keep the core meaning intact
3. Maintain subtitle-appropriate length (max 2 lines, ~40 characters per line)
4. Use natural, conversational language
5. Return only the enhanced ${sourceLanguageName} subtitle

Subtitle to enhance:
"""
${subtitle}
"""

Respond in JSON format:
{
  "line1_final": "enhanced subtitle text here"
}`;
  }

  return `You are a subtitle enhancement assistant for language learners. Process the following ${sourceLanguageName} subtitle for bilingual display.

Rules:
1. line1_final: Enhanced ${sourceLanguageName} subtitle adapted to ${difficultyLevel} CEFR level
2. line2_final: ${targetLanguageName} translation for reference
3. Keep each line under ~40 characters for readability
4. Preserve the core meaning in both lines
5. Use natural, conversational language

Subtitle to process:
"""
${subtitle}
"""

Respond in JSON format:
{
  "line1_final": "enhanced ${sourceLanguageName} subtitle",
  "line2_final": "${targetLanguageName} translation"
}`;
}

/**
 * Get human-readable language name.
 */
function getLanguageName(lang: SupportedLanguage | NativeLanguage): string {
  const names: Record<string, string> = {
    'en': 'English',
    'ja': 'Japanese',
    'ko': 'Korean',
    'fr': 'French',
    'de': 'German',
    'zh': 'Chinese',
    'zh-CN': 'Simplified Chinese',
    'zh-TW': 'Traditional Chinese',
  };
  return names[lang] || lang;
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

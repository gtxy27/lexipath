import type { CEFRLevel, SupportedLanguage, NativeLanguage } from '@lexipath/core';

export interface WebEnhancePromptOptions {
  content: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  difficultyMin: CEFRLevel;
  difficultyMax: CEFRLevel;
  maxWords?: number;
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
  } = options;

  const difficultyLabel = difficultyMin === difficultyMax
    ? difficultyMin
    : `${difficultyMin}-${difficultyMax}`;

  const sourceLanguageName = getLanguageName(sourceLang);
  const targetLanguageName = getLanguageName(targetLang);

  return `You are a vocabulary learning assistant. Analyze the following ${sourceLanguageName} text and select up to ${maxWords} vocabulary words to translate for language learners.

Rules:
1. Select vocabulary strictly within the ${difficultyLabel} CEFR difficulty range
2. Prioritize words with high educational value and frequency
3. Avoid: proper nouns, numbers, URLs, code snippets, single letters, stop words
4. For each selected word, provide:
   - original: the word as it appears in the text (preserve case)
   - converted: translation to ${targetLanguageName}
   - difficulty: CEFR level (A1, A2, B1, B2, C1, or C2)
5. Return the original text unchanged in content_result
6. The convert_word array is optional and may be empty if no suitable words are found

Text to analyze:
"""
${content}
"""

Respond in JSON format:
{
  "content_result": "original text here",
  "convert_word": [
    {"original": "example", "converted": "例子", "difficulty": "B1"},
    {"original": "significant", "converted": "重要的", "difficulty": "B2"}
  ]
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

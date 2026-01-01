import type { CEFRLevel, SupportedLanguage, NativeLanguage } from '@lexipath/core';

export interface ExplainWordPromptOptions {
  word: string;
  context?: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  userLevel: CEFRLevel;
}

/**
 * Build prompt for word/phrase explanation.
 *
 * The prompt instructs the LLM to:
 * 1. Provide translation to target language
 * 2. Include phonetic pronunciation (IPA for English, pinyin for Chinese, etc.)
 * 3. Determine CEFR difficulty level
 * 4. Give concise definition adapted to user's proficiency level
 * 5. Provide example usage if context is not provided
 * 6. Output structured JSON format
 */
export function buildExplainWordPrompt(options: ExplainWordPromptOptions): string {
  const {
    word,
    context,
    sourceLang,
    targetLang,
    userLevel,
  } = options;

  const sourceLanguageName = getLanguageName(sourceLang);
  const targetLanguageName = getLanguageName(targetLang);

  const contextSection = context
    ? `\nContext where the word appears:\n"${context}"`
    : '';

  const phoneticInstruction = getPhoneticInstruction(sourceLang, targetLang);

  return `You are a vocabulary learning assistant. Explain the following ${sourceLanguageName} word/phrase for a ${userLevel}-level language learner.

Word/Phrase: "${word}"${contextSection}

Provide:
1. translation: Translation to ${targetLanguageName}
2. phonetic: ${phoneticInstruction}
3. difficulty: CEFR level (A1, A2, B1, B2, C1, or C2)
4. definition: Concise definition in ${targetLanguageName} (adapted to ${userLevel} level)
5. example: Example sentence in ${sourceLanguageName} (only if no context provided)
6. example_translation: Translation of example sentence to ${targetLanguageName} (only if example provided)

Guidelines:
- Keep definitions simple and clear for ${userLevel}-level learners
- Use common, everyday language in explanations
- If the word has multiple meanings, choose the most relevant based on context${context ? '' : ' or the most common meaning'}

Respond in JSON format:
{
  "translation": "${targetLanguageName} translation",
  "phonetic": "pronunciation notation",
  "difficulty": "B1",
  "definition": "clear definition in ${targetLanguageName}",
  "example": "${sourceLanguageName} example sentence (optional)",
  "example_translation": "${targetLanguageName} translation (optional)"
}`;
}

/**
 * Get phonetic instruction based on languages.
 */
function getPhoneticInstruction(sourceLang: SupportedLanguage, targetLang: NativeLanguage): string {
  if (sourceLang === 'en') {
    return 'IPA phonetic notation for the English word';
  }
  if (sourceLang === 'zh') {
    return 'Pinyin with tone marks for the Chinese word';
  }
  if (sourceLang === 'ja') {
    return 'Romaji for the Japanese word';
  }
  if (sourceLang === 'ko') {
    return 'Romanization for the Korean word';
  }
  if (sourceLang === 'fr') {
    return 'IPA phonetic notation for the French word';
  }
  if (sourceLang === 'de') {
    return 'IPA phonetic notation for the German word';
  }

  if (targetLang.startsWith('zh')) {
    return 'Pinyin with tone marks for the translation';
  }

  return 'Phonetic notation';
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
 * Parse word explanation response from LLM.
 * Handles both plain JSON and markdown code blocks.
 */
export function parseExplainWordResponse(responseText: string): {
  translation: string;
  phonetic: string;
  difficulty: string;
  definition: string;
  example?: string;
  example_translation?: string;
} {
  try {
    let jsonStr = responseText.trim();

    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch?.[1]) {
      jsonStr = jsonMatch[1].trim();
    }

    const data = JSON.parse(jsonStr);

    if (!data.translation || !data.phonetic || !data.difficulty || !data.definition) {
      throw new Error('Missing required fields in response');
    }

    return {
      translation: data.translation,
      phonetic: data.phonetic,
      difficulty: data.difficulty,
      definition: data.definition,
      example: data.example,
      example_translation: data.example_translation,
    };
  } catch (error) {
    throw new Error(`Failed to parse explain word response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

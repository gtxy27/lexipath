import { BEHAVIORS, type CEFRLevel, type NativeLanguage, type PromptTemplateInput, type PromptUserInfo, type SupportedLanguage } from '@lexipath/core';
import { buildCefrOutputGuidance } from './cefr-guidance';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface ExplainWordPromptOptions {
  word: string;
  context?: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  userLevel: CEFRLevel;
  sceneValue: string;
  styleValue: string;
  userInfo: PromptUserInfo;
  behavior: typeof BEHAVIORS.explain_word;
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
    sceneValue,
    styleValue,
    userInfo,
    behavior,
  } = options;

  const phoneticInstruction = getPhoneticInstruction(sourceLang, targetLang);
  const cefrGuidance = buildCefrOutputGuidance({
    sourceLang,
    targetLang,
    level: userLevel,
  });
  const hasContext = Boolean(context && context.trim());
  const behaviorParams = {
    sourceLang,
    targetLang,
    userLevel,
    cefrGuidance,
    phoneticInstruction,
    hasContext,
  };

  const template: PromptTemplateInput = {
    role: behavior.role,
    scene: sceneValue,
    style: styleValue,
    task: behavior.task({ sourceLang, targetLang, userLevel }),
    userInfo,
    ...(context && context.trim()
      ? { contextInfo: { before: [context.trim()], after: [] } }
      : {}),
    userInput: word.trim(),
    outputFormat: behavior.outputFormat(behaviorParams),
    outputNotes: behavior.outputNotes(behaviorParams),
  };

  return renderPromptTemplate(template);
}

/**
 * Get phonetic instruction based on languages.
 */
function getPhoneticInstruction(sourceLang: SupportedLanguage, targetLang: NativeLanguage): string {
  if (sourceLang === 'en') {
    return '给出英文单词的 IPA 音标';
  }
  if (sourceLang === 'zh') {
    return '给出中文词语的拼音（带声调）';
  }
  if (sourceLang === 'ja') {
    return '给出日语词语的罗马音（Romaji）';
  }
  if (sourceLang === 'ko') {
    return '给出韩语词语的罗马化拼写（Romanization）';
  }
  if (sourceLang === 'fr') {
    return '给出法语单词的 IPA 音标';
  }
  if (sourceLang === 'de') {
    return '给出德语单词的 IPA 音标';
  }

  if (targetLang.startsWith('zh')) {
    return '若可行，给出翻译对应的拼音（带声调）';
  }

  return '给出合适的发音标注';
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

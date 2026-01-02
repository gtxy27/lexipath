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
    ? `\n出现语境：\n"${context}"`
    : '';

  const phoneticInstruction = getPhoneticInstruction(sourceLang, targetLang);

  return `你是词汇学习助手。请为一个 ${userLevel} 水平的语言学习者解释下面这个 ${sourceLanguageName} 的单词/短语。

单词/短语："${word}"${contextSection}

请输出一个 JSON 对象，包含字段：
1. translation：翻译成 ${targetLanguageName}
2. phonetic：${phoneticInstruction}
3. difficulty：CEFR 等级（A1/A2/B1/B2/C1/C2）
4. definition：用 ${targetLanguageName} 给出简明释义（难度适配 ${userLevel}）
5. example：${sourceLanguageName} 的例句（仅在未提供语境时给出）
6. example_translation：例句的 ${targetLanguageName} 翻译（仅在给出 example 时给出）

要求：
- 只输出 JSON，不要 Markdown，不要代码块，不要任何额外文字。
- 释义尽量简洁、口语化，适合 ${userLevel} 学习者。
- 如果有多个含义：优先选择与语境最相关的那个${context ? '' : '；若无语境则选择最常见含义'}。

JSON 格式示例（注意只输出 JSON）：
{
  "translation": "${targetLanguageName} 翻译",
  "phonetic": "发音标注",
  "difficulty": "B1",
  "definition": "${targetLanguageName} 简明释义",
  "example": "${sourceLanguageName} 例句（可选）",
  "example_translation": "${targetLanguageName} 例句翻译（可选）"
}`;
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
 * Get human-readable language name.
 */
function getLanguageName(lang: SupportedLanguage | NativeLanguage): string {
  const names: Record<string, string> = {
    'en': '英语',
    'ja': '日语',
    'ko': '韩语',
    'fr': '法语',
    'de': '德语',
    'zh': '中文',
    'zh-CN': '简体中文',
    'zh-TW': '繁体中文',
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

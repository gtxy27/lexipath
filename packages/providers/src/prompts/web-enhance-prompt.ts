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

  return `你是词汇学习助手。请分析下面这段 ${sourceLanguageName} 文本，为语言学习者挑选最多 ${maxWords} 个值得学习的词汇并翻译。

规则：
1. 只选择 CEFR 难度范围在 ${difficultyLabel} 内的词汇
2. 优先选择教育价值高、常见且有代表性的词
3. 避免：专有名词、人名地名、纯数字、URL、代码片段、单个字母、明显的虚词/停用词
4. 对每个入选词输出：
   - original：原文中出现的形式（保留大小写）
   - converted：翻译成 ${targetLanguageName}
   - difficulty：CEFR 等级（A1/A2/B1/B2/C1/C2）
5. content_result 必须返回原文，不做改写
6. convert_word 可为空数组；若没有合适词汇也可以返回空
7. 只输出 JSON，不要 Markdown，不要代码块，不要任何额外文字

待分析文本：
"""
${content}
"""

请输出 JSON：
{
  "content_result": "原文",
  "convert_word": [
    { "original": "example", "converted": "例子", "difficulty": "B1" },
    { "original": "significant", "converted": "重要的", "difficulty": "B2" }
  ]
}`;
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

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
    return `你是字幕增强助手，服务于语言学习者。请把下面的 ${sourceLanguageName} 字幕改写到符合 CEFR ${difficultyLevel} 水平，同时保持口语自然、适合字幕显示。

规则：
1. 词汇与语法难度适配 ${difficultyLevel}
2. 保持核心含义不变
3. 保持字幕长度合理（最多 2 行，每行约 40 个字符以内）
4. 使用自然、口语化表达
5. 只返回增强后的 ${sourceLanguageName} 字幕内容
6. 只输出 JSON，不要 Markdown，不要代码块，不要任何额外文字

待处理字幕：
"""
${subtitle}
"""

请输出 JSON：
{
  "line1_final": "增强后的字幕文本"
}`;
  }

  return `你是字幕增强助手，服务于语言学习者。请把下面的 ${sourceLanguageName} 字幕处理为双语展示。

规则：
1. line1_final：将 ${sourceLanguageName} 字幕改写到符合 CEFR ${difficultyLevel} 水平
2. line2_final：提供 ${targetLanguageName} 翻译用于对照
3. 每行尽量控制在约 40 个字符以内，便于阅读
4. 两行都要保持核心含义一致
5. 使用自然、口语化表达
6. 只输出 JSON，不要 Markdown，不要代码块，不要任何额外文字

待处理字幕：
"""
${subtitle}
"""

请输出 JSON：
{
  "line1_final": "增强后的 ${sourceLanguageName} 字幕",
  "line2_final": "${targetLanguageName} 翻译"
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

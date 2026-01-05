import type { CEFRLevel, ProficiencyPreference, SupportedLanguage, NativeLanguage, PromptTemplateInput } from '@lexipath/core';
import { buildProficiencyRangeReferenceLine } from './proficiency-reference';
import { buildCefrOutputGuidance } from './cefr-guidance';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface WebEnhancePromptOptions {
  content: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  difficultyMin: CEFRLevel;
  difficultyMax: CEFRLevel;
  maxWords?: number;
  proficiencyPreference?: ProficiencyPreference;
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
  const referenceLine = buildProficiencyRangeReferenceLine({
    sourceLang,
    targetLang,
    difficultyMin,
    difficultyMax,
    ...(options.proficiencyPreference
      ? { proficiencyPreference: options.proficiencyPreference }
      : {}),
  });
  const cefrGuidance = buildCefrOutputGuidance({
    sourceLang,
    targetLang,
    level: difficultyMax,
  });

  const template: PromptTemplateInput = {
    role: '你是词汇学习助手。',
    scene: '当前环境：网页内容增强（词汇挑选与翻译）。',
    style: '风格：面向语言学习者，优先教育价值高且常见的词汇，不做无关发挥。',
    task: `任务：分析<用户输入>中的${sourceLanguageName}文本，为语言学习者挑选最多 ${maxWords} 个值得学习的词汇/短语并翻译为${targetLanguageName}。只选择 CEFR 难度范围在 ${difficultyLabel} 内的词汇。`,
    userInfo: {
      motherTongue: targetLang,
      targetLearningLanguage: sourceLang,
      cefrLevel: difficultyMax,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    },
    userInput: content,
    outputFormat: `{
  "content_result": "",
  "convert_word": [
    { "original": "", "converted": "", "difficulty": "" }
  ]
}`,
    outputNotes: [
      cefrGuidance,
      '',
      '规则：',
      `1. 只选择 CEFR 难度范围在 ${difficultyLabel} 内的词汇`,
      '2. 优先选择教育价值高、常见且有代表性的词/短语（短语优先）',
      '3. 避免：专有名词、人名地名、纯数字、URL、代码片段、单个字母、明显的虚词/停用词',
      `4. 对每个入选词输出：original（原文形式，保留大小写）、converted（翻译为${targetLanguageName}）、difficulty（CEFR 等级）`,
      '5. content_result 必须返回原文，不做改写',
      '6. convert_word 可为空数组；若没有合适词汇也可以返回空数组',
      '7. 只输出一个 JSON 对象；不要 Markdown、不要代码块、不要任何额外文字',
    ].join('\n'),
  };

  return renderPromptTemplate(template);
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

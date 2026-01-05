import type {
  CEFRLevel,
  NativeLanguage,
  ProficiencyPreference,
  SupportedLanguage,
  PromptTemplateInput,
} from '@lexipath/core';
import { buildProficiencyReferenceLine } from './proficiency-reference';
import { renderPromptTemplate } from './prompt-template-renderer';

export interface KeywordSelectPromptOptions {
  text: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  userLevel: CEFRLevel;
  scene?: 'subtitle' | 'web';
  proficiencyPreference?: ProficiencyPreference;
}

export function buildKeywordSelectPrompt(options: KeywordSelectPromptOptions): string {
  const scene = options.scene ?? 'subtitle';
  const text = options.text.trim();
  const referenceLine = buildProficiencyReferenceLine({
    sourceLang: options.sourceLang,
    targetLang: options.targetLang,
    userLevel: options.userLevel,
    ...(options.proficiencyPreference
      ? { proficiencyPreference: options.proficiencyPreference }
      : {}),
  });
  const levelHint = `学习目标：优先选择对 CEFR ${options.userLevel} 有提升价值的词/短语（接近或略高于该水平），不要挑太基础的词。`;

  const template: PromptTemplateInput = {
    role: '你是关键词选择助手。',
    scene: `当前环境：${scene === 'web' ? '网页' : '字幕'}文本关键词提取场景。`,
    style: '风格：面向语言学习者，短语优先，避免无学习价值或不稳定的词条。',
    task: `任务：从<用户输入>中挑选对学习者最有价值的关键词/短语。${levelHint}`,
    userInfo: {
      motherTongue: options.targetLang,
      targetLearningLanguage: options.sourceLang,
      cefrLevel: options.userLevel,
      ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
    },
    userInput: text,
    outputFormat: `[""]`,
    outputNotes: [
      '规则（非常重要）：',
      '1. 只输出一个 JSON 字符串数组（string array）；不要 Markdown、不要代码块、不要任何额外文字',
      '2. 数组中的每个元素必须是原文中出现的：一个单词或一个短语（固定搭配/短语动词/习语）；短语优先',
      '3. 排除人名、地名等专有名词',
      '4. 排除基础数字/计数词（例如 3、three），除非它对句子含义至关重要',
      '5. 最多返回 8 个元素',
      '6. 不要输出索引/位置等信息',
    ].join('\n'),
  };

  return renderPromptTemplate(template);
}

function stripCodeFences(input: string): string {
  return input
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

function tryParseJsonArray(input: string): string[] | null {
  try {
    const parsed = JSON.parse(input);
    if (!Array.isArray(parsed)) return null;
    const strings = parsed.filter((item) => typeof item === 'string') as string[];
    return strings;
  } catch {
    return null;
  }
}

function extractFirstJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;
  const end = text.lastIndexOf(']');
  if (end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizeKeyword(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function parseKeywordSelectResponse(response: string): { keywords: string[]; ok: boolean } {
  const cleaned = stripCodeFences(response);
  if (!cleaned) return { keywords: [], ok: false };

  const direct = tryParseJsonArray(cleaned);
  const parsed = direct ?? ((): string[] | null => {
    const extracted = extractFirstJsonArray(cleaned);
    if (!extracted) return null;
    return tryParseJsonArray(extracted);
  })();

  if (!parsed) return { keywords: [], ok: false };

  const seen = new Set<string>();
  const keywords: string[] = [];

  for (const item of parsed) {
    const normalized = normalizeKeyword(item);
    if (!normalized) continue;
    if (normalized.length > 120) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    keywords.push(normalized);
  }

  return { keywords, ok: true };
}

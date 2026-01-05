import type { CEFRLevel, NativeLanguage, ProficiencyPreference, SupportedLanguage } from '@lexipath/core';
import { buildProficiencyReferenceLine } from './proficiency-reference';

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
  const referenceSection = referenceLine ? `\n- ${referenceLine}` : '';
  const levelHint = `学习目标：优先选择对 ${options.userLevel} 有提升价值的词/短语（接近或略高于该水平），不要挑太基础的词。`;

  return `你是 LexiPath，一个语言学习助手。

任务：从下面这段 ${scene} 文本中，挑选对学习者最有价值的“关键词/短语”。

学习者信息：
- 母语：${options.targetLang}
- 目标语言：${options.sourceLang}
- 水平：${options.userLevel}${referenceSection}
${levelHint}

规则（非常重要）：
- 只输出一个 JSON 字符串数组（string array）。不要输出 Markdown、不要代码块、不要任何额外文字。
- 数组中的每个元素必须是原文中出现的：一个单词 或 一个短语（固定搭配/短语动词/习语）；短语优先。
- 排除人名、地名等专有名词。
- 排除基础数字/计数词（例如 3、three），除非它对句子含义至关重要。
- 最多返回 8 个元素。
- 不要输出索引/位置等信息。

文本：
${text}
`;
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

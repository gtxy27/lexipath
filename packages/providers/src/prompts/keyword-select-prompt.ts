import type { CEFRLevel, NativeLanguage, SupportedLanguage } from '@lexipath/core';

export interface KeywordSelectPromptOptions {
  text: string;
  sourceLang: SupportedLanguage;
  targetLang: NativeLanguage;
  userLevel: CEFRLevel;
  scene?: 'subtitle' | 'web';
}

export function buildKeywordSelectPrompt(options: KeywordSelectPromptOptions): string {
  const scene = options.scene ?? 'subtitle';
  const text = options.text.trim();

  return `You are LexiPath, a language learning assistant.

Task: Select key vocabulary items from the given ${scene} text for a learner.

Learner:
- Native language: ${options.targetLang}
- Target language: ${options.sourceLang}
- Level: ${options.userLevel}

Rules:
- Output ONLY a JSON array of strings. No markdown, no code fences, no extra text.
- Each item must be a word OR a short phrase (collocation/phrasal verb/idiom) that appears in the text.
- Prefer phrases when they carry meaning beyond the individual words.
- Exclude people names and place names.
- Exclude basic numbers/counting words (e.g., 3, three) unless they are essential to meaning.
- Return at most 8 items.
- Do NOT output indices/positions.

Text:
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

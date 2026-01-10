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
  } catch (error: unknown) {
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
  const parsed =
    direct ??
    (() => {
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
    throw new Error(
      `Failed to parse explain word response: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

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


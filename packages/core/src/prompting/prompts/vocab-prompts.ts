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

function extractJsonArrays(text: string, limit = 3): string[] {
  const results: string[] = [];

  const len = text.length;
  let index = 0;

  while (index < len && results.length < limit) {
    const start = text.indexOf('[', index);
    if (start === -1) break;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < len; i += 1) {
      const ch = text[i] ?? '';

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '[') {
        depth += 1;
        continue;
      }

      if (ch === ']') {
        depth -= 1;
        if (depth === 0) {
          results.push(text.slice(start, i + 1));
          index = i + 1;
          break;
        }
      }
    }

    // If we hit the end without closing brackets, stop scanning to avoid infinite loops.
    if (results.length === 0 || index <= start) {
      break;
    }
  }

  return results;
}

function normalizeKeyword(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export function parseKeywordSelectResponse(response: string): { keywords: string[]; ok: boolean } {
  const cleaned = stripCodeFences(response);
  if (!cleaned) return { keywords: [], ok: false };

  const direct = tryParseJsonArray(cleaned);
  const extractedArrays = direct ? [] : extractJsonArrays(cleaned, 3);
  const parsedArrays = extractedArrays.map((candidate) => tryParseJsonArray(candidate)).filter(Boolean) as string[][];

  // The keyword_select prompt may return multiple arrays (e.g. a second "too hard" bucket).
  // For now we only consume the first array and ignore the rest.
  const parsed = direct ?? parsedArrays[0] ?? null;

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
    if (!data || typeof data !== 'object') {
      throw new Error('Parsed value is not an object');
    }

    // `content_result` may be omitted in fast web_enhance mode to save tokens.
    if (typeof (data as any).content_result !== 'string') {
      (data as any).content_result = '';
    }
    return data;
  } catch (error) {
    throw new Error(`Failed to parse web enhance response: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

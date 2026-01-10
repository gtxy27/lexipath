function stripCodeFences(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, ''))
    .trim();
}

function normalizeLine(line: string): string {
  let value = line.trim();
  if (!value) return '';

  value = value.replace(/^\d+[.)]\s*/, '').replace(/^[-*]\s*/, '').trim();

  const colonIndex = Math.max(value.lastIndexOf(':'), value.lastIndexOf('：'));
  if (colonIndex > 0) {
    const after = value.slice(colonIndex + 1).trim();
    if (after) value = after;
  }

  return value.trim();
}

export function parseTranslateKeywordsResponse(
  response: string,
  expectedCount?: number
): { translations: string[]; ok: boolean } {
  const cleaned = stripCodeFences(response);
  if (!cleaned) return { translations: [], ok: false };

  const translations = cleaned
    .replace(/\r/g, '')
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean);

  if (typeof expectedCount === 'number' && Number.isFinite(expectedCount) && expectedCount >= 0) {
    return { translations, ok: translations.length === expectedCount };
  }

  return { translations, ok: translations.length > 0 };
}

function stripCodeFencesJson(input: string): string {
  return input
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  const end = text.lastIndexOf('}');
  if (end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function parseTranslationObject(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  const maybeWrapped = record.translations;
  const target = maybeWrapped && typeof maybeWrapped === 'object' ? (maybeWrapped as Record<string, unknown>) : record;

  const translations: Record<string, string> = {};
  for (const [key, value] of Object.entries(target)) {
    if (typeof value !== 'string') continue;
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    translations[normalizedKey] = value;
  }
  return Object.keys(translations).length ? translations : null;
}

export function parseTermTranslateResponse(response: string): { translations: Record<string, string>; ok: boolean } {
  const cleaned = stripCodeFencesJson(response);
  if (!cleaned) return { translations: {}, ok: false };

  const candidates = [cleaned, extractFirstJsonObject(cleaned)].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const translations = parseTranslationObject(parsed);
      if (translations) return { translations, ok: true };
    } catch (error: unknown) {
      // ignore parse error; try next candidate
    }
  }

  return { translations: {}, ok: false };
}


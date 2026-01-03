export interface TermTranslatePromptOptions {
  terms: string[];
  sourceLang: string;
  targetLang: string;
}

export function buildTermTranslatePrompt(options: TermTranslatePromptOptions): string {
  const terms = options.terms.map((term) => term.trim()).filter(Boolean);

  return `你是一个翻译助手。请把给定的术语从 ${options.sourceLang} 翻译为 ${options.targetLang}。

规则（非常重要）：
- 只输出 JSON，不要输出 Markdown，不要输出代码块，不要输出任何解释文字
- 输出必须是一个 JSON 对象，key 为原术语（与输入完全一致），value 为翻译结果
- 不要添加或删除术语；必须对每个术语给出一个翻译

术语列表：
${terms.map((term) => `- ${term}`).join('\n')}
`;
}

function stripCodeFences(input: string): string {
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
  const cleaned = stripCodeFences(response);
  if (!cleaned) return { translations: {}, ok: false };

  const candidates = [cleaned, extractFirstJsonObject(cleaned)].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      const translations = parseTranslationObject(parsed);
      if (translations) return { translations, ok: true };
    } catch {
      // continue
    }
  }

  return { translations: {}, ok: false };
}


export interface TranslateKeywordsPromptOptions {
  keywords: string[];
  context?: string;
  sourceLang: string;
  targetLang: string;
}

export function buildTranslateKeywordsPrompt(options: TranslateKeywordsPromptOptions): string {
  const keywords = options.keywords.map((term) => term.trim()).filter(Boolean);
  const context = options.context?.trim();

  return `你是一个专业的翻译助手。请将给定的单词列表从 ${options.sourceLang} 翻译为 ${options.targetLang}。

规则（非常重要）：
- 严格按输入顺序输出
- 每行只输出一个翻译结果
- 不要输出序号、项目符号、解释、JSON、Markdown 或代码块
- 只输出最常见、最基础的译法（不要多个释义）
${context ? '- 如提供上下文，请结合上下文选择最合适的译法\n' : ''}输入（每行一个词）：
${keywords.join('\n')}
${context ? `\n上下文：\n${context}\n` : ''}`;
}

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


import { WebEnhanceOutputSchema, type WebEnhanceOutput } from '../types';
import { fail, ok, type Result } from './result';
import { z } from 'zod';

const WEB_ENHANCE_FALLBACK: WebEnhanceOutput = {
  content_result: '',
};

function extractJsonFromCodeFence(text: string): string {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const fenced = match?.[1];
  return fenced ? fenced.trim() : text.trim();
}

function tryParseJson(text: string): unknown | null {
  const cleaned = extractJsonFromCodeFence(text);
  const candidates = [cleaned];

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error: unknown) {
      // Ignore parse error; try next candidate.
      void error;
      continue;
    }
  }

  return null;
}

function getBaselineLength(rawValue: unknown): number | null {
  if (!rawValue || typeof rawValue !== 'object') return null;

  const record = rawValue as Record<string, unknown>;

  const numericCandidates: Array<unknown> = [
    record.pureOriginalContentChars,
    record.originalLength,
    record.original_length,
    record.inputLength,
    record.input_length,
  ];
  for (const candidate of numericCandidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) {
      return candidate;
    }
  }

  const stringCandidates: Array<unknown> = [
    record.content_original,
    record.contentOriginal,
    record.original_content,
    record.originalContent,
    record.content,
    record.input,
    record.text,
    record.source,
  ];
  for (const candidate of stringCandidates) {
    if (typeof candidate === 'string') {
      return candidate.length;
    }
  }

  return null;
}

/**
 * Validate WebEnhanceOutput produced by an LLM/provider.
 *
 * Requirements (PLAN.md §6 + docs/TRANSLATION_BEHAVIOR.md):
 * - JSON parseable (string input supported, including ```json fences)
 * - Must contain `content_result`
 * - Length inflation < 2x when a baseline length is available
 * - On any failure, return a safe fallback value
 */
export function validateWebEnhanceOutput(raw: unknown): Result<WebEnhanceOutput> {
  const parsedUnknown = typeof raw === 'string' ? tryParseJson(raw) : raw;
  if (parsedUnknown == null) return fail(WEB_ENHANCE_FALLBACK);

  // Allow `content_result` to be omitted for the fast web_enhance prompt path, since the renderer uses the
  // original page text directly and echoing it wastes tokens.
  const WebEnhanceLlmSchema = z.object({
    content_result: z.string().optional(),
    convert_word: WebEnhanceOutputSchema.shape.convert_word,
    highlight_terms: WebEnhanceOutputSchema.shape.highlight_terms,
    highlight_offsets: WebEnhanceOutputSchema.shape.highlight_offsets,
  });

  const parsed = WebEnhanceLlmSchema.safeParse(parsedUnknown);
  if (!parsed.success) return fail(WEB_ENHANCE_FALLBACK);
  if (parsed.data.content_result == null && parsed.data.convert_word == null) return fail(WEB_ENHANCE_FALLBACK);

  const normalized: WebEnhanceOutput = {
    content_result: parsed.data.content_result ?? '',
    ...(parsed.data.convert_word != null ? { convert_word: parsed.data.convert_word } : {}),
    ...(parsed.data.highlight_terms != null ? { highlight_terms: parsed.data.highlight_terms } : {}),
    ...(parsed.data.highlight_offsets != null ? { highlight_offsets: parsed.data.highlight_offsets } : {}),
  };

  const baselineLength = getBaselineLength(parsedUnknown) ?? normalized.content_result.length;
  const denom = baselineLength > 0 ? baselineLength : 1;
  const inflation = normalized.content_result.length / denom;

  if (!(inflation < 2)) return fail(WEB_ENHANCE_FALLBACK);

  return ok(normalized);
}

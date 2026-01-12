import { SubtitleEnhanceOutputSchema, type SubtitleEnhanceOutput } from '../types';
import { fail, ok, type Result } from './result';

const SUBTITLE_ENHANCE_FALLBACK: SubtitleEnhanceOutput = {
  line1_final: '',
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
      // ignore parse error; try next candidate
    }
  }

  return null;
}

function normalizePlainLine(line: string): string {
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

function tryParsePlainSubtitle(text: string): SubtitleEnhanceOutput | null {
  const cleaned = extractJsonFromCodeFence(text).replace(/\r/g, '').trim();
  if (!cleaned) return null;

  // If the model attempted JSON but it's not parseable, don't surface raw braces as a subtitle.
  if (cleaned.includes('{') || cleaned.includes('}')) return null;

  const lines = cleaned
    .split('\n')
    .map(normalizePlainLine)
    .filter(Boolean)
    .slice(0, 2);

  if (lines.length === 0) return null;

  return { line1_final: lines.join('\n') };
}

function getNestedCorrectedResults(rawValue: unknown): unknown | null {
  if (!rawValue || typeof rawValue !== 'object') return null;

  const record = rawValue as Record<string, unknown>;
  const validation = record.validation;
  if (!validation || typeof validation !== 'object') return null;

  const validationRecord = validation as Record<string, unknown>;
  return validationRecord.corrected_results ?? null;
}

/**
 * Validate SubtitleEnhanceOutput produced by an LLM/provider.
 *
 * Requirements (PLAN.md §6):
 * - Must contain `line1_final`
 * - `line2_final` / `line3_final` are optional
 * - String input supported, including ```json fences
 * - Accepts plain-text subtitles (1~2 lines) for newer prompt formats
 * - Tolerates legacy wrapper shape: { validation: { corrected_results: {...} } }
 * - On any failure, return a safe fallback value
 */
export function validateSubtitleEnhanceOutput(raw: unknown): Result<SubtitleEnhanceOutput> {
  if (typeof raw === 'string') {
    const parsedUnknown = tryParseJson(raw);
    if (parsedUnknown != null) {
      const direct = SubtitleEnhanceOutputSchema.safeParse(parsedUnknown);
      if (direct.success) return ok(direct.data);

      const nested = getNestedCorrectedResults(parsedUnknown);
      if (nested != null) {
        const nestedParsed = SubtitleEnhanceOutputSchema.safeParse(nested);
        if (nestedParsed.success) return ok(nestedParsed.data);
      }
    }

    const plain = tryParsePlainSubtitle(raw);
    if (plain) return ok(plain);

    return fail(SUBTITLE_ENHANCE_FALLBACK);
  }

  const direct = SubtitleEnhanceOutputSchema.safeParse(raw);
  if (direct.success) return ok(direct.data);

  const nested = getNestedCorrectedResults(raw);
  if (nested == null) return fail(SUBTITLE_ENHANCE_FALLBACK);

  const nestedParsed = SubtitleEnhanceOutputSchema.safeParse(nested);
  if (!nestedParsed.success) return fail(SUBTITLE_ENHANCE_FALLBACK);

  return ok(nestedParsed.data);
}

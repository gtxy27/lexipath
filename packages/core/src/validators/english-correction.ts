import { EnglishCorrectionOutputSchema, type EnglishCorrectionOutput } from '../types';
import { fail, ok, type Result } from './result';

const ENGLISH_CORRECTION_FALLBACK: EnglishCorrectionOutput = {
  hasError: false,
  corrected: null,
  message: '',
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
    } catch {
      // continue
    }
  }

  return null;
}

function normalizeOutput(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const record = raw as Record<string, unknown>;

  const hasError = typeof record.hasError === 'boolean' ? record.hasError : undefined;
  const corrected = record.corrected;
  const message = typeof record.message === 'string' ? record.message.trim() : '';

  const normalized: Record<string, unknown> = { ...record };

  if (typeof hasError === 'boolean') {
    normalized.hasError = hasError;
    if (!hasError) {
      normalized.corrected = null;
    }
  }

  if (typeof corrected === 'string') {
    if (hasError !== false) {
      normalized.corrected = corrected;
    }
  }

  if (typeof normalized.message === 'string') {
    const trimmed = (normalized.message as string).trim();
    normalized.message = trimmed.length > 50 ? trimmed.slice(0, 50) : trimmed;
  } else {
    normalized.message = message.length > 50 ? message.slice(0, 50) : message;
  }

  return normalized;
}

export function validateEnglishCorrectionOutput(raw: unknown): Result<EnglishCorrectionOutput> {
  const parsedUnknown = typeof raw === 'string' ? tryParseJson(raw) : raw;
  if (parsedUnknown == null) return fail(ENGLISH_CORRECTION_FALLBACK);

  const normalized = normalizeOutput(parsedUnknown);
  const parsed = EnglishCorrectionOutputSchema.safeParse(normalized);
  if (!parsed.success) return fail(ENGLISH_CORRECTION_FALLBACK);

  return ok(parsed.data);
}

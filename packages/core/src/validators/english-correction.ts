import { EnglishCorrectionOutputSchema, type EnglishCorrectionOutput } from '../types';
import { fail, ok, type Result } from './result';

const ENGLISH_CORRECTION_FALLBACK: EnglishCorrectionOutput = {
  hasError: false,
  corrected: null,
  message: '',
};

export type EnglishCorrectionValidationFailureReason =
  | 'EMPTY'
  | 'INVALID_JSON'
  | 'INVALID_SCHEMA'
  | 'INVALID_TYPE';

export type EnglishCorrectionValidationDetailedResult =
  | { ok: true; value: EnglishCorrectionOutput }
  | { ok: false; fallback: EnglishCorrectionOutput; reason: EnglishCorrectionValidationFailureReason };

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

export function validateEnglishCorrectionOutputDetailed(raw: unknown): EnglishCorrectionValidationDetailedResult {
  if (raw === undefined || raw === null) {
    return { ok: false, fallback: ENGLISH_CORRECTION_FALLBACK, reason: 'EMPTY' };
  }

  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: false, fallback: ENGLISH_CORRECTION_FALLBACK, reason: 'EMPTY' };

    const parsedUnknown = tryParseJson(trimmed);
    if (parsedUnknown == null) {
      return { ok: false, fallback: ENGLISH_CORRECTION_FALLBACK, reason: 'INVALID_JSON' };
    }

    const normalized = normalizeOutput(parsedUnknown);
    const parsed = EnglishCorrectionOutputSchema.safeParse(normalized);
    if (!parsed.success) {
      return { ok: false, fallback: ENGLISH_CORRECTION_FALLBACK, reason: 'INVALID_SCHEMA' };
    }

    return { ok: true, value: parsed.data };
  }

  if (typeof raw !== 'object') {
    return { ok: false, fallback: ENGLISH_CORRECTION_FALLBACK, reason: 'INVALID_TYPE' };
  }

  const normalized = normalizeOutput(raw);
  const parsed = EnglishCorrectionOutputSchema.safeParse(normalized);
  if (!parsed.success) {
    return { ok: false, fallback: ENGLISH_CORRECTION_FALLBACK, reason: 'INVALID_SCHEMA' };
  }

  return { ok: true, value: parsed.data };
}

export function validateEnglishCorrectionOutput(raw: unknown): Result<EnglishCorrectionOutput> {
  const detailed = validateEnglishCorrectionOutputDetailed(raw);
  return detailed.ok ? ok(detailed.value) : fail(detailed.fallback);
}

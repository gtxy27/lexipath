import { z } from 'zod';
import { ChannelSchema, SettingsSchema } from '../types';
import {
  DetectedLanguageSchema,
  detectPrimaryLanguage,
  type DetectedLanguage,
} from './language';
import { countLetterLikeAndSuspiciousRepetition } from './unicode';

export const TextKindSchema = z.enum(['page', 'paragraph']);
export type TextKind = z.infer<typeof TextKindSchema>;

export const CoreLanguageSettingsSchema = SettingsSchema.pick({
  nativeLanguage: true,
  targetLanguage: true,
});
export type CoreLanguageSettings = z.infer<typeof CoreLanguageSettingsSchema>;

export const GetChannelInputSchema = z.object({
  language: DetectedLanguageSchema,
  settings: CoreLanguageSettingsSchema,
});
export type GetChannelInput = z.infer<typeof GetChannelInputSchema>;

export const GetChannelOutputSchema = z.object({
  channel: ChannelSchema,
});
export type GetChannelOutput = z.infer<typeof GetChannelOutputSchema>;

function nativeLanguageToDetected(nativeLanguage: CoreLanguageSettings['nativeLanguage']): Exclude<
  DetectedLanguage,
  'unknown'
> {
  if (nativeLanguage === 'en') return 'en';
  return 'zh';
}

export function getChannel(input: GetChannelInput): GetChannelOutput {
  if (input.language === 'unknown') return { channel: 'else' };

  const native = nativeLanguageToDetected(input.settings.nativeLanguage);
  if (input.language === native) return { channel: 'native' };
  if (input.language === input.settings.targetLanguage) return { channel: 'target' };

  return { channel: 'else' };
}

export const AnalyzeTextQualityInputSchema = z.object({
  text: z.string(),
  kind: TextKindSchema.optional(),
  minNormalizedLength: z.number().int().nonnegative().optional(),
  minLetterLikeChars: z.number().int().nonnegative().optional(),
});
export type AnalyzeTextQualityInput = z.infer<typeof AnalyzeTextQualityInputSchema>;

export const AnalyzeTextQualityOutputSchema = z.object({
  skippable: z.boolean(),
  reason: z.enum(['ok', 'empty', 'too_short', 'junk']),
  normalizedText: z.string(),
  normalizedLength: z.number().int().nonnegative(),
  letterLikeChars: z.number().int().nonnegative(),
});
export type AnalyzeTextQualityOutput = z.infer<typeof AnalyzeTextQualityOutputSchema>;

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function getQualityStats(text: string): { letterLikeChars: number; hasSuspiciousRepetition: boolean } {
  return countLetterLikeAndSuspiciousRepetition(text);
}

function getDefaultThresholds(kind: TextKind): { minNormalizedLength: number; minLetterLikeChars: number } {
  if (kind === 'page') return { minNormalizedLength: 200, minLetterLikeChars: 60 };
  return { minNormalizedLength: 20, minLetterLikeChars: 8 };
}

/**
 * Cheap, deterministic text quality gating.
 *
 * Intention: skip empty/too-short/junk content before expensive language/channel logic.
 */
export function analyzeTextQuality(input: AnalyzeTextQualityInput): AnalyzeTextQualityOutput {
  const kind = input.kind ?? 'paragraph';
  const { minNormalizedLength, minLetterLikeChars } = {
    ...getDefaultThresholds(kind),
    ...(input.minNormalizedLength != null ? { minNormalizedLength: input.minNormalizedLength } : {}),
    ...(input.minLetterLikeChars != null ? { minLetterLikeChars: input.minLetterLikeChars } : {}),
  };

  const normalizedText = normalizeText(input.text);
  const normalizedLength = normalizedText.length;

  if (!normalizedText) {
    return {
      skippable: true,
      reason: 'empty',
      normalizedText: '',
      normalizedLength: 0,
      letterLikeChars: 0,
    };
  }

  const { letterLikeChars, hasSuspiciousRepetition } = getQualityStats(normalizedText);

  if (normalizedLength < minNormalizedLength || letterLikeChars < minLetterLikeChars) {
    return {
      skippable: true,
      reason: 'too_short',
      normalizedText,
      normalizedLength,
      letterLikeChars,
    };
  }

  const letterRatio = normalizedLength > 0 ? letterLikeChars / normalizedLength : 0;
  if (letterRatio < 0.25 || hasSuspiciousRepetition) {
    return {
      skippable: true,
      reason: 'junk',
      normalizedText,
      normalizedLength,
      letterLikeChars,
    };
  }

  return {
    skippable: false,
    reason: 'ok',
    normalizedText,
    normalizedLength,
    letterLikeChars,
  };
}

export const QualifyContentInputSchema = z.object({
  text: z.string(),
  settings: CoreLanguageSettingsSchema,
  kind: TextKindSchema.optional(),
  minLanguageConfidence: z.number().min(0).max(1).optional(),
  minNormalizedLength: z.number().int().nonnegative().optional(),
  minLetterLikeChars: z.number().int().nonnegative().optional(),
});
export type QualifyContentInput = z.infer<typeof QualifyContentInputSchema>;

export const QualifyContentDecisionSchema = z.object({
  qualified: z.boolean(),
  reason: z.enum([
    'allowed',
    'empty',
    'too_short',
    'junk',
    'unknown_language',
    'native_language',
    'other_language',
  ]),
  language: DetectedLanguageSchema,
  confidence: z.number().min(0).max(1),
  channel: ChannelSchema,
  normalizedText: z.string(),
});
export type QualifyContentDecision = z.infer<typeof QualifyContentDecisionSchema>;

/**
 * Full content gating:
 * - quality gate (empty/too-short/junk)
 * - detect primary language (page/paragraph)
 * - classify channel (native/target/else)
 * - allow only `target` channel by default
 */
export function qualifyContent(input: QualifyContentInput): QualifyContentDecision {
  const kind = input.kind ?? 'paragraph';
  const quality = analyzeTextQuality({
    text: input.text,
    kind,
    minNormalizedLength: input.minNormalizedLength,
    minLetterLikeChars: input.minLetterLikeChars,
  });

  if (quality.skippable) {
    return {
      qualified: false,
      reason: quality.reason === 'ok' ? 'junk' : quality.reason,
      language: 'unknown',
      confidence: 0,
      channel: 'else',
      normalizedText: quality.normalizedText,
    };
  }

  const detected = detectPrimaryLanguage({ text: quality.normalizedText });
  const minLanguageConfidence = input.minLanguageConfidence ?? 0.2;

  if (detected.language === 'unknown' || detected.confidence < minLanguageConfidence) {
    return {
      qualified: false,
      reason: 'unknown_language',
      language: detected.language,
      confidence: detected.confidence,
      channel: 'else',
      normalizedText: quality.normalizedText,
    };
  }

  const { channel } = getChannel({ language: detected.language, settings: input.settings });
  if (channel === 'target') {
    return {
      qualified: true,
      reason: 'allowed',
      language: detected.language,
      confidence: detected.confidence,
      channel,
      normalizedText: quality.normalizedText,
    };
  }

  return {
    qualified: false,
    reason: channel === 'native' ? 'native_language' : 'other_language',
    language: detected.language,
    confidence: detected.confidence,
    channel,
    normalizedText: quality.normalizedText,
  };
}


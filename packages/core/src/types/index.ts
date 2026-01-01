import { z } from 'zod';

// =============================================================================
// Language & Locale
// =============================================================================

export const SupportedLanguageSchema = z.enum(['en', 'ja', 'ko', 'fr', 'de', 'zh']);
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

export const NativeLanguageSchema = z.enum(['zh-CN', 'zh-TW', 'en']);
export type NativeLanguage = z.infer<typeof NativeLanguageSchema>;

// =============================================================================
// Channel (content language classification)
// =============================================================================

export const ChannelSchema = z.enum(['native', 'target', 'else']);
export type Channel = z.infer<typeof ChannelSchema>;

// =============================================================================
// Difficulty & Proficiency
// =============================================================================

export const CEFRLevelSchema = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
export type CEFRLevel = z.infer<typeof CEFRLevelSchema>;

export const JLPTLevelSchema = z.enum(['N5', 'N4', 'N3', 'N2', 'N1']);
export type JLPTLevel = z.infer<typeof JLPTLevelSchema>;

export const TOPIKLevelSchema = z.enum(['1', '2', '3', '4', '5', '6']);
export type TOPIKLevel = z.infer<typeof TOPIKLevelSchema>;

// Internal unified proficiency score (1-10)
export const ProficiencyScoreSchema = z.number().min(1).max(10);
export type ProficiencyScore = z.infer<typeof ProficiencyScoreSchema>;

// =============================================================================
// Message Protocol
// =============================================================================

export const MessageTypeSchema = z.enum([
  'GET_SETTINGS',
  'SET_SETTINGS',
  'REQUEST_HOST_PERMISSION',
  'ENHANCE_WEB',
  'ENHANCE_SUBTITLE',
  'EXPLAIN_WORD',
  'CHAT',
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

export const MessageSchema = z.object({
  type: MessageTypeSchema,
  payload: z.unknown(),
});
export type Message = z.infer<typeof MessageSchema>;

export const SuccessResponseSchema = <T extends z.ZodType>(valueSchema: T) =>
  z.object({
    ok: z.literal(true),
    value: valueSchema,
  });

export const ErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type SuccessResponse<T> = { ok: true; value: T };
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type Response<T> = SuccessResponse<T> | ErrorResponse;

// =============================================================================
// Provider Configuration
// =============================================================================

export const ProviderConfigSchema = z.object({
  baseUrl: z.string().url(),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  customHeaders: z.record(z.string()).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// =============================================================================
// Settings
// =============================================================================

export const SettingsSchema = z.object({
  // Language
  nativeLanguage: NativeLanguageSchema.default('zh-CN'),
  targetLanguage: SupportedLanguageSchema.default('en'),
  proficiencyLevel: CEFRLevelSchema.default('B1'),

  // Provider
  provider: ProviderConfigSchema.optional(),

  // Behavior
  enabled: z.boolean().default(true),
  autoEnhance: z.boolean().default(true),

  // Site rules
  siteMode: z.enum(['all', 'whitelist']).default('all'),
  excludedSites: z.array(z.string()).default([]),
  allowedSites: z.array(z.string()).default([]),
});
export type Settings = z.infer<typeof SettingsSchema>;

// =============================================================================
// Subtitle Cue
// =============================================================================

export const CueSourceSchema = z.enum(['youtube', 'bilibili', 'netflix', 'generic']);
export type CueSource = z.infer<typeof CueSourceSchema>;

export const CueSchema = z.object({
  id: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  text: z.string(),
  lang: z.string(),
  source: CueSourceSchema,
});
export type Cue = z.infer<typeof CueSchema>;

// =============================================================================
// Web Enhancement Output
// =============================================================================

export const ConvertedWordSchema = z.object({
  original: z.string(),
  converted: z.string(),
  difficulty: z.string().optional(),
});
export type ConvertedWord = z.infer<typeof ConvertedWordSchema>;

export const WebEnhanceOutputSchema = z.object({
  content_result: z.string(),
  convert_word: z.array(ConvertedWordSchema).optional(),
});
export type WebEnhanceOutput = z.infer<typeof WebEnhanceOutputSchema>;

// =============================================================================
// Subtitle Enhancement Output
// =============================================================================

export const SubtitleEnhanceOutputSchema = z.object({
  line1_final: z.string(),
  line2_final: z.string().optional(),
  line3_final: z.string().optional(),
});
export type SubtitleEnhanceOutput = z.infer<typeof SubtitleEnhanceOutputSchema>;

// =============================================================================
// Word & Familiarity
// =============================================================================

export const WordFamiliaritySchema = z.object({
  word: z.string(),
  familiarity: z.number().min(0).max(1),
  lastSeen: z.number(),
  encounters: z.number(),
});
export type WordFamiliarity = z.infer<typeof WordFamiliaritySchema>;

export const LearnedWordSchema = z.object({
  original: z.string(),
  translation: z.string(),
  difficulty: z.string().optional(),
  phonetic: z.string().optional(),
  addedAt: z.number(),
});
export type LearnedWord = z.infer<typeof LearnedWordSchema>;

// =============================================================================
// Tier & Strategy
// =============================================================================

export const TierSchema = z.enum(['easy', 'medium', 'hard']);
export type Tier = z.infer<typeof TierSchema>;

export const MasterWordsSchema = z.object({
  familiar: z.array(z.string()),
  unfamiliar: z.array(z.string()),
});
export type MasterWords = z.infer<typeof MasterWordsSchema>;

export const StrategyOutputSchema = z.object({
  tier: TierSchema,
  masterWords: MasterWordsSchema,
});
export type StrategyOutput = z.infer<typeof StrategyOutputSchema>;

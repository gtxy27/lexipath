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
  'TEST_PROVIDER_CONNECTION',
  'SELECT_KEYWORDS',
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

export const TestProviderConnectionPayloadSchema = z
  .object({
    provider: ProviderConfigSchema,
  })
  .strict();
export type TestProviderConnectionPayload = z.infer<typeof TestProviderConnectionPayloadSchema>;

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

  // Concurrency (advanced)
  // Keyed by `${baseUrl}|${model}` (per-model concurrency limit).
  modelConcurrencyLimits: z.record(z.number().int().min(1).max(500)).default({}),

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
// Web Enhancement Payload
// =============================================================================

export const EnhanceWebPayloadSchema = z
  .object({
    content: z.string().min(1),
    sourceLang: SupportedLanguageSchema.optional(),
    targetLang: NativeLanguageSchema.optional(),
    difficultyMin: CEFRLevelSchema.optional(),
    difficultyMax: CEFRLevelSchema.optional(),
    maxWords: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type EnhanceWebPayload = z.infer<typeof EnhanceWebPayloadSchema>;

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
// Subtitle Enhancement Payload
// =============================================================================

export const EnhanceSubtitlePayloadSchema = z
  .object({
    subtitle: z.string().min(1),
    sourceLang: SupportedLanguageSchema.optional(),
    targetLang: NativeLanguageSchema.optional(),
    difficultyLevel: CEFRLevelSchema.optional(),
    mode: z.enum(['single', 'bilingual']).optional(),
  })
  .strict();
export type EnhanceSubtitlePayload = z.infer<typeof EnhanceSubtitlePayloadSchema>;

// =============================================================================
// Word & Familiarity
// =============================================================================

export const WordFamiliaritySchema = z.object({
  word: z.string(),
  // 0–100 score used by strategy (see docs/WORD_FAMILIARITY_RESEARCH.md)
  familiarity: z.number().min(0).max(100),
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

// =============================================================================
// Chat
// =============================================================================

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.number(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatPayloadSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().optional(),
});
export type ChatPayload = z.infer<typeof ChatPayloadSchema>;

export const ChatResponseSchema = z.object({
  reply: z.string(),
  conversationId: z.string(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// =============================================================================
// Explain Word
// =============================================================================

export const ExplainWordPayloadSchema = z
  .object({
    word: z.string().min(1),
    context: z.string().min(1).optional(),
  })
  .strict();
export type ExplainWordPayload = z.infer<typeof ExplainWordPayloadSchema>;

export const ExplainWordOutputSchema = z
  .object({
    word: z.string().min(1),
    definition: z.string().min(1),
    phonetic: z.string().min(1).optional(),
    difficulty: z.string().min(1).optional(),
    translation: z.string().min(1).optional(),
    example: z.string().min(1).optional(),
    example_translation: z.string().min(1).optional(),
  })
  .strict();
export type ExplainWordOutput = z.infer<typeof ExplainWordOutputSchema>;

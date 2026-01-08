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

// User-facing proficiency standards (optional UI preference)
export const ProficiencyStandardSchema = z.enum(['IELTS', 'CET-4', 'CET-6', 'JLPT', 'TOPIK']);
export type ProficiencyStandard = z.infer<typeof ProficiencyStandardSchema>;

export const ProficiencyPreferenceSchema = z
  .object({
    standard: ProficiencyStandardSchema,
    value: z.string().min(1),
  })
  .strict();
export type ProficiencyPreference = z.infer<typeof ProficiencyPreferenceSchema>;

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
  'TRANSLATE_KEYWORDS',
  'ENHANCE_WEB',
  'ENHANCE_SUBTITLE',
  'ENGLISH_CORRECTION',
  'EXPLAIN_WORD',
  'BATCH_GET_WORD_FAMILIARITY',
  'RECORD_EXPOSURE_VALID',
  'CHAT',
  'GET_CHAT_SESSIONS',
  'GET_CHAT_MESSAGES',
  'OPEN_SIDEBAR',
  'EXPORT_DATA',
  'IMPORT_DATA',
  'SEARCH_MESSAGES',
  'TEST_WEBDAV_CONNECTION',
  'WEBDAV_UPLOAD',
  'WEBDAV_DOWNLOAD',
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
  baseUrl: z.string().url().optional(),
  model: z.string().min(1),
  apiKey: z.string().optional(),
  customHeaders: z.record(z.string()).optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ClaudeProviderConfigSchema = z.object({
  model: z.string().min(1),
  apiKey: z.string().min(1),
  // Optional override for proxies / self-hosted gateways.
  baseUrl: z.string().url().optional(),
  customHeaders: z.record(z.string()).optional(),
});
export type ClaudeProviderConfig = z.infer<typeof ClaudeProviderConfigSchema>;

export const GeminiProviderConfigSchema = z.object({
  model: z.string().min(1),
  apiKey: z.string().min(1),
  // Optional override for proxies / self-hosted gateways.
  baseUrl: z.string().url().optional(),
  customHeaders: z.record(z.string()).optional(),
});
export type GeminiProviderConfig = z.infer<typeof GeminiProviderConfigSchema>;

export const LLMProviderChannelSchema = z.enum(['openai', 'claude', 'gemini']);
export type LLMProviderChannel = z.infer<typeof LLMProviderChannelSchema>;

export const TranslationProviderSchema = z.enum(['openai', 'claude', 'gemini', 'google', 'bing']);
export type TranslationProvider = z.infer<typeof TranslationProviderSchema>;

// =============================================================================
// Channels & Routing (multi-channel + behavior routing table)
// =============================================================================

// Channel.typeId (adapter selection), starting from 1:
// 1=openai-compatible, 2=claude, 3=gemini
export const ChannelTypeIdSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type ChannelTypeId = z.infer<typeof ChannelTypeIdSchema>;

export const ChannelConfigSchema = z.record(z.unknown()).default({});
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

export const ProviderChannelSchema = z
  .object({
    channelId: z.number().int().min(1),
    typeId: ChannelTypeIdSchema,
    name: z.string().default(''),
    model: z.string().default(''),
    config: ChannelConfigSchema,
    iconUrl: z.string().optional(),
    concurrencyLimit: z.number().int().min(1).max(500).default(15),
    extra: z.record(z.unknown()).default({}),
  })
  .strict();
export type ProviderChannel = z.infer<typeof ProviderChannelSchema>;

export const ProviderChannelsSchema = z
  .array(ProviderChannelSchema)
  .default([
    {
      channelId: 1,
      typeId: 1,
      name: 'Default',
      model: '',
      config: {},
      concurrencyLimit: 15,
      extra: {},
    },
  ]);
export type ProviderChannels = z.infer<typeof ProviderChannelsSchema>;

// Routing table kinds, starting from 1:
// 1=channel, 2=google, 3=bing
export const RouteKindSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type RouteKind = z.infer<typeof RouteKindSchema>;

export const RouteConfigSchema = z
  .object({
    kind: RouteKindSchema,
    channelId: z.number().int().min(1).optional(),
    extra: z.record(z.unknown()).default({}),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 1 && typeof value.channelId !== 'number') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'channelId is required when kind=channel',
        path: ['channelId'],
      });
    }
  });
export type RouteConfig = z.infer<typeof RouteConfigSchema>;

const BehaviorKeySchema = z.string().regex(/^[a-z0-9_]+$/);
export const BehaviorRoutesSchema = z
  .record(BehaviorKeySchema, RouteConfigSchema)
  .default({
    select_keywords: { kind: 1, channelId: 1, extra: {} },
    translate: { kind: 1, channelId: 1, extra: {} },
    translate_keywords: { kind: 1, channelId: 1, extra: {} },
    dictionary: { kind: 1, channelId: 1, extra: {} },
    adapt_subtitle: { kind: 1, channelId: 1, extra: {} },
    english_correction: { kind: 1, channelId: 1, extra: {} },
    chat: { kind: 1, channelId: 1, extra: {} },
  });
export type BehaviorRoutes = z.infer<typeof BehaviorRoutesSchema>;

export const TestProviderConnectionPayloadSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('openai'),
      config: ProviderConfigSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('claude'),
      config: ClaudeProviderConfigSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('gemini'),
      config: GeminiProviderConfigSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('google'),
    })
    .strict(),
  z
    .object({
      type: z.literal('bing'),
    })
    .strict(),
]);
export type TestProviderConnectionPayload = z.infer<typeof TestProviderConnectionPayloadSchema>;

// =============================================================================
// Settings
// =============================================================================

export const ThemeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof ThemeSchema>;

export const PromptStyleKeySchema = z.enum([
  'default',
  'anime',
  'academic',
  'casual',
  'concise',
]);
export type PromptStyleKey = z.infer<typeof PromptStyleKeySchema>;

export const WebDAVConfigSchema = z.object({
  url: z.string().url(),
  username: z.string(),
  password: z.string(),
  path: z.string().default('/LexiPath/backup.json'),
});
export type WebDAVConfig = z.infer<typeof WebDAVConfigSchema>;

export const EnglishCorrectionConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    triggerKey: z.string().min(1).default('space'),
    triggerTimes: z.number().int().min(1).max(5).default(3),
    triggerTimeout: z.number().int().min(100).max(2000).default(500),
    autoCloseDelay: z.number().int().min(0).max(10000).default(3000),
    showUndoButton: z.boolean().default(true),
  })
  .strict()
  .default({
    enabled: false,
    triggerKey: 'space',
    triggerTimes: 3,
    triggerTimeout: 500,
    autoCloseDelay: 3000,
    showUndoButton: true,
  });
export type EnglishCorrectionConfig = z.infer<typeof EnglishCorrectionConfigSchema>;

export const WebEnhanceModeSchema = z.enum(['light', 'i_plus_1', 'full']);
export type WebEnhanceMode = z.infer<typeof WebEnhanceModeSchema>;

// =============================================================================
// Web UI Display / Style System (plan15)
// =============================================================================

export const WebStyleKeySchema = z.enum([
  'border',
  'dashedLine',
  'weakened',
  'background',
  'textColor',
]);
export type WebStyleKey = z.infer<typeof WebStyleKeySchema>;

export const WebStyleMappingSchema = z
  .object({
    within: WebStyleKeySchema.default('dashedLine'),
    out: WebStyleKeySchema.default('border'),
    forgotten: WebStyleKeySchema.default('weakened'),
  })
  .strict()
  .default({
    within: 'dashedLine',
    out: 'border',
    forgotten: 'weakened',
  });
export type WebStyleMapping = z.infer<typeof WebStyleMappingSchema>;

export const SceneFlagsSchema = z
  .object({
    webNative: z.boolean().default(true),
    webTarget: z.boolean().default(true),
    videoNative: z.boolean().default(true),
    videoTarget: z.boolean().default(true),
  })
  .strict()
  .default({
    webNative: true,
    webTarget: true,
    videoNative: true,
    videoTarget: true,
  });
export type SceneFlags = z.infer<typeof SceneFlagsSchema>;

export const SettingsSchema = z.object({
  // Language
  nativeLanguage: NativeLanguageSchema.default('zh-CN'),
  targetLanguage: SupportedLanguageSchema.default('en'),
  proficiencyLevel: CEFRLevelSchema.default('B1'),
  // Optional (for UI/prompt display): store the user's preferred exam scale (CEFR remains the internal value).
  proficiencyPreference: ProficiencyPreferenceSchema.optional(),
  // Target level (goal): stored as CEFR; preference is optional and only affects UI selection.
  targetProficiencyLevel: CEFRLevelSchema.default('B2'),
  targetProficiencyPreference: ProficiencyPreferenceSchema.optional(),

  // Appearance
  theme: ThemeSchema.default('system'),
  // Prompt style selection (applies when prompt builder supports styles).
  promptStyle: PromptStyleKeySchema.default('default'),

  // Provider channels (multi-channel, one model per channel)
  channels: ProviderChannelsSchema,

  // Behavior routing table
  behaviorRoutes: BehaviorRoutesSchema,

  // Behavior
  enabled: z.boolean().default(true),
  autoEnhance: z.boolean().default(true),
  webEnhanceMode: WebEnhanceModeSchema.default('i_plus_1'),
  floatingButtonEnabled: z.boolean().default(true),
  webShowOriginal: z.boolean().default(false),
  webStyleMapping: WebStyleMappingSchema,
  webCustomCss: z.string().max(2000).default(''),
  scenesEnabled: SceneFlagsSchema,
  hasCompletedOnboarding: z.boolean().default(false),

  // English correction (3x space)
  englishCorrection: EnglishCorrectionConfigSchema,

  // Site rules
  siteMode: z.enum(['all', 'whitelist']).default('all'),
  excludedSites: z.array(z.string()).default([]),
  allowedSites: z.array(z.string()).default([]),

  // Backup (Cloud)
  webdav: WebDAVConfigSchema.optional(),
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
  difficultyLevel: CEFRLevelSchema.optional(),
  difficultyConfidence: z.number().min(0).max(1).optional(),
  partOfSpeech: z.string().optional(),
});
export type ConvertedWord = z.infer<typeof ConvertedWordSchema>;

export const WebHighlightOffsetSchema = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    term: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.end <= value.start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'highlight offset end must be > start',
        path: ['end'],
      });
    }
  });
export type WebHighlightOffset = z.infer<typeof WebHighlightOffsetSchema>;

export const WebEnhanceOutputSchema = z.object({
  content_result: z.string(),
  convert_word: z.array(ConvertedWordSchema).optional(),
  highlight_terms: z.array(z.string()).optional(),
  highlight_offsets: z.array(WebHighlightOffsetSchema).optional(),
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
    mode: WebEnhanceModeSchema.optional(),
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
// English Correction Output / Payload
// =============================================================================

export const EnglishCorrectionOutputSchema = z
  .object({
    hasError: z.boolean(),
    corrected: z.string().nullable(),
    message: z.string().max(50),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.hasError && value.corrected !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'corrected must be null when hasError=false',
        path: ['corrected'],
      });
    }
    if (value.hasError && (!value.corrected || !value.corrected.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'corrected is required when hasError=true',
        path: ['corrected'],
      });
    }
  });
export type EnglishCorrectionOutput = z.infer<typeof EnglishCorrectionOutputSchema>;

export const EnglishCorrectionPayloadSchema = z
  .object({
    text: z.string().min(1),
  })
  .strict();
export type EnglishCorrectionPayload = z.infer<typeof EnglishCorrectionPayloadSchema>;

// =============================================================================
// Keyword Batch Translation Payload
// =============================================================================

export const TranslateKeywordsPayloadSchema = z
  .object({
    keywords: z.array(z.string().min(1)).min(1),
    context: z.string().optional(),
    sourceLang: z.string().min(1),
    targetLang: z.string().min(1),
  })
  .strict();
export type TranslateKeywordsPayload = z.infer<typeof TranslateKeywordsPayloadSchema>;

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

import browser from 'webextension-polyfill';
import { z } from 'zod';
import { StorageExportSchema } from '@lexipath/storage';
import { createLogger, getErrorMessage } from '@lexipath/core/log';
import {
  CEFRLevelSchema,
  ChatPayloadSchema,
  ChatResponseSchema,
  EnglishCorrectionOutputSchema,
  EnglishCorrectionPayloadSchema,
  EnhanceSubtitlePayloadSchema,
  EnhanceWebPayloadSchema,
  ErrorResponseSchema,
  ExplainWordOutputSchema,
  ExplainWordPayloadSchema,
  MessageSchema,
  MessageTypeSchema,
  NativeLanguageSchema,
  SettingsSchema,
  SubtitleEnhanceOutputSchema,
  SupportedLanguageSchema,
  SuccessResponseSchema,
  TestProviderConnectionPayloadSchema,
  TranslateKeywordsPayloadSchema,
  WordFamiliaritySchema,
  WebDAVConfigSchema,
  WebEnhanceOutputSchema,
  type ErrorResponse,
  type MessageType,
  type Response,
  type Settings,
} from '@lexipath/core';

const log = createLogger('shared:messages');

export type StructuredError = { code: string; message: string };

export class MessageError extends Error {
  code: string;

  constructor({ code, message }: StructuredError) {
    super(message);
    this.name = 'MessageError';
    this.code = code;
  }
}

export function errorResponse(code: string, message: string): ErrorResponse {
  return { ok: false, error: { code, message } };
}

export function unknownToErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof MessageError) {
    return errorResponse(error.code, error.message);
  }
  if (error instanceof z.ZodError) {
    return errorResponse('VALIDATION_ERROR', error.message);
  }
  if (error instanceof Error) {
    return errorResponse('INTERNAL_ERROR', error.message);
  }
  const fallback = (() => {
    try {
      const msg = browser.i18n?.getMessage?.('error_unknown');
      return typeof msg === 'string' && msg.trim() ? msg : 'error_unknown';
    } catch (i18nError: unknown) {
      log.debug('i18n.getMessage threw while building unknown-error fallback', { message: getErrorMessage(i18nError) });
      return 'error_unknown';
    }
  })();
  return errorResponse('INTERNAL_ERROR', fallback);
}

const SetSettingsPayloadSchema = SettingsSchema.partial()
  .strict()
  .transform((partial): Partial<Settings> => {
    const cleaned: Partial<Settings> = {};
    for (const [key, value] of Object.entries(partial)) {
      if (
        value !== undefined ||
        key === 'webdav' ||
        key === 'proficiencyPreference' ||
        key === 'targetProficiencyPreference'
      ) {
        (cleaned as Record<string, unknown>)[key] = value;
      }
    }
    return cleaned;
  });

const UsageBucketSchema = z
  .object({
    events: z.number().int().min(0),
    apiEvents: z.number().int().min(0),
    words: z.number().int().min(0),
  })
  .strict();

const DailyUsageSummarySchema = z
  .object({
    date: z.string().min(1),
    updatedAt: z.number().int().min(0),
    totals: UsageBucketSchema,
    tasks: z.record(UsageBucketSchema),
    providers: z.record(UsageBucketSchema),
  })
  .strict();

const UsageSummaryResponseSchema = z
  .object({
    today: DailyUsageSummarySchema,
    recentDays: z.array(DailyUsageSummarySchema),
  })
  .strict();

const EnglishCorrectionOutcomeBucketSchema = z
  .object({
    requests: z.number().int().min(0),
    correct: z.number().int().min(0),
    incorrect: z.number().int().min(0),
  })
  .strict();

const DailyEnglishCorrectionOutcomeSummarySchema = z
  .object({
    date: z.string().min(1),
    updatedAt: z.number().int().min(0),
    totals: EnglishCorrectionOutcomeBucketSchema,
  })
  .strict();

const EnglishCorrectionOutcomeSummaryResponseSchema = z
  .object({
    today: DailyEnglishCorrectionOutcomeSummarySchema,
    recentDays: z.array(DailyEnglishCorrectionOutcomeSummarySchema),
  })
  .strict();

const ReportUsageEventPayloadSchema = z
  .object({
    event: z.enum(['word_card_opened']),
    word: z.string().min(1),
    scene: z.enum(['web', 'subtitle', 'sidebar', 'popup']).optional(),
  })
  .strict();

const WebProcessingStatusSchema = z
  .object({
    keywordProviderConfigured: z.boolean(),
    translationProviderConfigured: z.boolean(),
    webEnhanceConcurrencyLimit: z.number().int().min(1).max(500),
  })
  .strict();

const messageDefinitions = {
  GET_SETTINGS: {
    payloadSchema: z.undefined(),
    valueSchema: SettingsSchema,
  },
  GET_WEB_PROCESSING_STATUS: {
    payloadSchema: z.undefined(),
    valueSchema: WebProcessingStatusSchema,
  },
  SET_SETTINGS: {
    payloadSchema: SetSettingsPayloadSchema,
    valueSchema: z.null(),
  },
  GET_USAGE_SUMMARY: {
    payloadSchema: z.undefined(),
    valueSchema: UsageSummaryResponseSchema,
  },
  GET_ENGLISH_CORRECTION_OUTCOME_SUMMARY: {
    payloadSchema: z.object({ days: z.number().int().min(1).max(365).optional() }).optional(),
    valueSchema: EnglishCorrectionOutcomeSummaryResponseSchema,
  },
  REPORT_USAGE_EVENT: {
    payloadSchema: ReportUsageEventPayloadSchema,
    valueSchema: z.null(),
  },
  REQUEST_HOST_PERMISSION: {
    payloadSchema: z
      .object({
        origin: z.string().min(1),
      })
      .strict(),
    valueSchema: z.boolean(),
  },
  TEST_PROVIDER_CONNECTION: {
    payloadSchema: TestProviderConnectionPayloadSchema,
    valueSchema: z.literal(true),
  },
  SELECT_KEYWORDS: {
    payloadSchema: z
      .object({
        text: z.string().min(1),
        scene: z.enum(['subtitle', 'web']).optional(),
        sourceLang: SupportedLanguageSchema.optional(),
        targetLang: NativeLanguageSchema.optional(),
        userLevel: CEFRLevelSchema.optional(),
        contextBefore: z.array(z.string().min(1)).optional(),
        contextAfter: z.array(z.string().min(1)).optional(),
      })
      .strict(),
    valueSchema: z.array(z.string()),
  },
  TRANSLATE_KEYWORDS: {
    payloadSchema: TranslateKeywordsPayloadSchema,
    valueSchema: z.array(z.string()),
  },
  ENHANCE_WEB: {
    payloadSchema: EnhanceWebPayloadSchema,
    valueSchema: WebEnhanceOutputSchema,
  },
  ENHANCE_SUBTITLE: {
    payloadSchema: EnhanceSubtitlePayloadSchema,
    valueSchema: SubtitleEnhanceOutputSchema,
  },
  ENGLISH_CORRECTION: {
    payloadSchema: EnglishCorrectionPayloadSchema,
    valueSchema: EnglishCorrectionOutputSchema,
  },
  EXPLAIN_WORD: {
    payloadSchema: ExplainWordPayloadSchema,
    valueSchema: ExplainWordOutputSchema,
  },
  BATCH_GET_WORD_FAMILIARITY: {
    payloadSchema: z
      .object({
        words: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    valueSchema: z.array(WordFamiliaritySchema),
  },
  RECORD_EXPOSURE_VALID: {
    payloadSchema: z
      .object({
        words: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    valueSchema: z.null(),
  },
  CHAT: {
    payloadSchema: ChatPayloadSchema,
    valueSchema: ChatResponseSchema,
  },
  GET_CHAT_SESSIONS: {
    payloadSchema: z.object({ keyword: z.string().optional() }).optional(),
    valueSchema: StorageExportSchema.shape.sessions,
  },
  GET_CHAT_MESSAGES: {
    payloadSchema: z.object({ sessionId: z.string(), limit: z.number().optional() }),
    valueSchema: StorageExportSchema.shape.messages,
  },
  OPEN_SIDEBAR: {
    payloadSchema: z
      .object({
        initialMessage: z.string().optional(),
        keyword: z.string().optional(),
        isAutoSend: z.boolean().optional(),
        contextInfo: z
          .object({
            kind: z.literal('subtitle'),
            platform: z.string().optional(),
            title: z.string().optional(),
            timestampSec: z.number().optional(),
            lines: z.array(z.string()).optional(),
          })
          .optional(),
      })
      .optional(),
    valueSchema: z.object({ ok: z.literal(true) }),
  },
  EXPORT_DATA: {
    payloadSchema: z.undefined(),
    valueSchema: StorageExportSchema,
  },
  IMPORT_DATA: {
    payloadSchema: StorageExportSchema,
    valueSchema: z.object({ ok: z.literal(true) }),
  },
  SEARCH_MESSAGES: {
    payloadSchema: z.object({ query: z.string(), limit: z.number().optional() }),
    valueSchema: StorageExportSchema.shape.messages,
  },
  TEST_WEBDAV_CONNECTION: {
    payloadSchema: WebDAVConfigSchema,
    valueSchema: z.object({ ok: z.literal(true) }),
  },
  WEBDAV_UPLOAD: {
    payloadSchema: WebDAVConfigSchema,
    valueSchema: z.object({ ok: z.literal(true) }),
  },
  WEBDAV_DOWNLOAD: {
    payloadSchema: WebDAVConfigSchema,
    valueSchema: z.object({ ok: z.literal(true) }),
  },
} satisfies Record<
  MessageType,
  { payloadSchema: z.ZodTypeAny; valueSchema: z.ZodTypeAny }
>;

export type MessagePayload<TType extends MessageType> = z.infer<
  (typeof messageDefinitions)[TType]['payloadSchema']
>;
export type MessageValue<TType extends MessageType> = z.infer<
  (typeof messageDefinitions)[TType]['valueSchema']
>;

function normalizeMessageInput(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  return { payload: undefined, ...(input as Record<string, unknown>) };
}

function responseSchemaFor<TType extends MessageType>(type: TType) {
  return z.union([
    SuccessResponseSchema(messageDefinitions[type].valueSchema),
    ErrorResponseSchema,
  ]);
}

function parseResponse<TType extends MessageType>(
  type: TType,
  response: unknown
): Response<MessageValue<TType>> {
  const parsed = responseSchemaFor(type).safeParse(response);
  if (parsed.success) {
    return parsed.data as Response<MessageValue<TType>>;
  }
  return errorResponse('INVALID_RESPONSE', parsed.error.message);
}

export function sendMessage<TType extends MessageType>(
  type: TType,
  payload: MessagePayload<TType>
): Promise<Response<MessageValue<TType>>>;
export function sendMessage<T>(
  type: MessageType,
  payload: unknown
): Promise<Response<T>>;
export async function sendMessage(
  type: MessageType,
  payload: unknown
): Promise<Response<unknown>> {
  const parsedType = MessageTypeSchema.safeParse(type);
  if (!parsedType.success) {
    return errorResponse('INVALID_MESSAGE_TYPE', parsedType.error.message);
  }
  const typeKey = parsedType.data;

  const payloadResult = messageDefinitions[typeKey].payloadSchema.safeParse(payload);
  if (!payloadResult.success) {
    return errorResponse('INVALID_PAYLOAD', payloadResult.error.message);
  }

  try {
    const response = await browser.runtime.sendMessage({
      type: typeKey,
      payload: payloadResult.data,
    });
    return parseResponse(typeKey, response);
  } catch (error) {
    log.warn('browser.runtime.sendMessage threw', { type: typeKey, message: getErrorMessage(error) });
    return unknownToErrorResponse(error);
  }
}

export type MessageHandler<TType extends MessageType> = (
  payload: MessagePayload<TType>,
  sender: browser.Runtime.MessageSender
) => Promise<MessageValue<TType>> | MessageValue<TType>;

export function createMessageHandlerRegistry() {
  type AnyHandler = (
    payload: unknown,
    sender: browser.Runtime.MessageSender
  ) => Promise<unknown> | unknown;

  const handlers = new Map<MessageType, AnyHandler>();

  function register<TType extends MessageType>(type: TType, handler: MessageHandler<TType>) {
    handlers.set(type, handler as unknown as AnyHandler);
  }

  async function handleIncomingMessage(
    rawMessage: unknown,
    sender: browser.Runtime.MessageSender
  ): Promise<Response<unknown>> {
    const messageResult = MessageSchema.safeParse(normalizeMessageInput(rawMessage));
    if (!messageResult.success) {
      return errorResponse('INVALID_MESSAGE', messageResult.error.message);
    }

    const { type, payload } = messageResult.data;
    const handler = handlers.get(type);
    if (!handler) {
      return errorResponse('NO_HANDLER', `No handler registered for ${type}`);
    }

    const payloadResult = messageDefinitions[type].payloadSchema.safeParse(payload);
    if (!payloadResult.success) {
      return errorResponse('INVALID_PAYLOAD', payloadResult.error.message);
    }

    try {
      const value = await handler(payloadResult.data, sender);
      const valueResult = messageDefinitions[type].valueSchema.safeParse(value);
      if (!valueResult.success) {
        return errorResponse('INVALID_RESPONSE', valueResult.error.message);
      }
      return { ok: true, value: valueResult.data };
    } catch (error) {
      log.error('Message handler threw', { type, message: getErrorMessage(error) });
      return unknownToErrorResponse(error);
    }
  }

  return {
    register,
    handleIncomingMessage,
  };
}

export type { Settings };

/**
 * LexiPath Background Service Worker
 *
 * Handles:
 * - Message routing between content/popup/ui
 * - Provider API calls
 * - Caching and session management
 * - Optional host permissions
 */

import browser from 'webextension-polyfill';
import { z } from 'zod';

import {
  CEFRLevelSchema,
  NativeLanguageSchema,
  SupportedLanguageSchema,
  type EnhanceSubtitlePayload,
  type EnhanceWebPayload,
  type CEFRLevel,
  type ExplainWordOutput,
  type ExplainWordPayload,
  type ProviderConfig,
  type SubtitleEnhanceOutput,
  type WebEnhanceOutput,
} from '@lexipath/core';
import { validateSubtitleEnhanceOutput, validateWebEnhanceOutput } from '@lexipath/core/validators';
import { OpenAICompatibleProvider } from '@lexipath/providers';
import {
  buildExplainWordPrompt,
  buildKeywordSelectPrompt,
  buildSubtitleEnhancePrompt,
  buildWebEnhancePrompt,
  parseExplainWordResponse,
  parseKeywordSelectResponse,
} from '@lexipath/providers/prompts';
import { DictionaryService } from '@lexipath/dictionary';

import { MessageError, createMessageHandlerRegistry } from '../shared/messages';
import { recordLookup } from '../shared/familiarity';
import { getSettings, setSettings } from '../shared/storage';
import {
  createExpiringLruCache,
  getOrRunCachedTask,
  makeCacheKey,
  stableStringify,
  dedupeInFlight,
} from './pipeline';
import { filterSelectedKeywords } from './keyword-filter';

const registry = createMessageHandlerRegistry();

const CACHE_MAX_ENTRIES = 200;
const CACHE_SUCCESS_TTL_MS = 5 * 60 * 1000;
const CACHE_FALLBACK_TTL_MS = 60 * 1000;
const DEFAULT_MODEL_CONCURRENCY = 20;
const CONCURRENCY_SATURATION_LOG_THROTTLE_MS = 1500;

type ConcurrencyState = { inFlight: number; waiters: Array<() => void> };
const modelConcurrency = new Map<string, ConcurrencyState>();
const lastSaturationLogAt = new Map<string, number>();

function t(key: string, substitutions?: string | string[], fallback = ''): string {
  try {
    const message = browser.i18n?.getMessage?.(key, substitutions as any);
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // ignore
  }
  return fallback || key;
}

function providerModelKey(config: ProviderConfig): string {
  return `${config.baseUrl}|${config.model}`;
}

function getModelConcurrencyLimit(settings: { modelConcurrencyLimits?: Record<string, number> }, config: ProviderConfig): number {
  const key = providerModelKey(config);
  const raw = settings.modelConcurrencyLimits?.[key];
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.min(500, Math.floor(raw));
  }
  return DEFAULT_MODEL_CONCURRENCY;
}

async function acquireConcurrencySlot(key: string, limit: number): Promise<() => void> {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const state = modelConcurrency.get(key) ?? { inFlight: 0, waiters: [] };
  modelConcurrency.set(key, state);

  if (state.inFlight < normalizedLimit) {
    state.inFlight += 1;
    return () => releaseConcurrencySlot(key);
  }

  const now = Date.now();
  const lastLoggedAt = lastSaturationLogAt.get(key) ?? 0;
  if (now - lastLoggedAt >= CONCURRENCY_SATURATION_LOG_THROTTLE_MS) {
    lastSaturationLogAt.set(key, now);
    console.warn(
      `[LexiPath] Provider concurrency saturated (${key}) inFlight=${state.inFlight}/${normalizedLimit} queued=${state.waiters.length + 1}`
    );
  }

  return new Promise((resolve) => {
    const queuedAt = Date.now();
    state.waiters.push(() => {
      const waitedMs = Date.now() - queuedAt;
      if (waitedMs >= 250) {
        console.debug(`[LexiPath] Provider concurrency wait (${key}) waitedMs=${waitedMs}`);
      }
      state.inFlight += 1;
      resolve(() => releaseConcurrencySlot(key));
    });
  });
}

function releaseConcurrencySlot(key: string): void {
  const state = modelConcurrency.get(key);
  if (!state) return;

  state.inFlight = Math.max(0, state.inFlight - 1);
  const next = state.waiters.shift();
  if (next) next();
}

async function runWithModelConcurrency<T>(
  settings: { modelConcurrencyLimits?: Record<string, number> },
  config: ProviderConfig,
  work: () => Promise<T>
): Promise<T> {
  const key = providerModelKey(config);
  const limit = getModelConcurrencyLimit(settings, config);
  const release = await acquireConcurrencySlot(key, limit);
  try {
    return await work();
  } finally {
    release();
  }
}

let providerInstance: OpenAICompatibleProvider | null = null;
let providerConfigKey: string | null = null;

function providerKey(config: ProviderConfig): string {
  return stableStringify({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey ?? '',
    customHeaders: config.customHeaders ?? {},
  });
}

function getProvider(config: ProviderConfig | undefined): OpenAICompatibleProvider | null {
  if (!config) return null;

  const key = providerKey(config);
  if (providerInstance && providerConfigKey === key) return providerInstance;

  providerInstance?.cancel();
  providerInstance = new OpenAICompatibleProvider(config);
  providerConfigKey = key;
  return providerInstance;
}

const CEFR_LEVELS: readonly CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function getDefaultDifficultyRange(level: CEFRLevel): { difficultyMin: CEFRLevel; difficultyMax: CEFRLevel } {
  const idx = CEFR_LEVELS.indexOf(level);
  const safeIdx = idx === -1 ? CEFR_LEVELS.indexOf('B1') : idx;
  const minIdx = Math.max(0, safeIdx - 1);
  const maxIdx = Math.min(CEFR_LEVELS.length - 1, safeIdx + 1);
  return {
    difficultyMin: CEFR_LEVELS[minIdx] ?? 'A1',
    difficultyMax: CEFR_LEVELS[maxIdx] ?? 'C2',
  };
}

const webEnhanceCache = createExpiringLruCache<WebEnhanceOutput>(CACHE_MAX_ENTRIES);
const subtitleEnhanceCache = createExpiringLruCache<SubtitleEnhanceOutput>(CACHE_MAX_ENTRIES);
const keywordSelectCache = createExpiringLruCache<string[]>(CACHE_MAX_ENTRIES);
const explainWordCache = createExpiringLruCache<ExplainWordOutput>(CACHE_MAX_ENTRIES);
const webEnhanceInFlight = new Map<string, Promise<WebEnhanceOutput>>();
const subtitleEnhanceInFlight = new Map<string, Promise<SubtitleEnhanceOutput>>();
const keywordSelectInFlight = new Map<string, Promise<string[]>>();
const explainWordInFlight = new Map<string, Promise<ExplainWordOutput>>();
const dictionaryService = new DictionaryService();

type CaptionRequestCacheEntry = { params: string; timestamp: number };
const YOUTUBE_CAPTION_PARAMS_TTL_MS = 10 * 60 * 1000;
const youtubeCaptionRequestParams = new Map<string, CaptionRequestCacheEntry>();

function extractYouTubeTimedtextAdditionalParams(url: URL): string {
  const entries = Array.from(url.searchParams.entries());
  const potcIndex = entries.findIndex(([key]) => key === 'potc');
  if (potcIndex < 0) return '';
  return entries
    .slice(potcIndex)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
}

function getCachedYouTubeCaptionParams(videoId: string): string {
  const entry = youtubeCaptionRequestParams.get(videoId);
  if (!entry) return '';
  if (Date.now() - entry.timestamp > YOUTUBE_CAPTION_PARAMS_TTL_MS) {
    youtubeCaptionRequestParams.delete(videoId);
    return '';
  }
  return entry.params;
}

registry.register('GET_SETTINGS', async () => {
  return getSettings();
});

registry.register('SET_SETTINGS', async (payload) => {
  await setSettings(payload);
  return null;
});

function normalizeOriginToHostPattern(origin: string): string {
  const trimmed = origin.trim();
  if (!trimmed) {
    throw new MessageError({ code: 'INVALID_ORIGIN', message: t('error_invalidOrigin') });
  }

  if (trimmed === '<all_urls>') {
    throw new MessageError({ code: 'INVALID_ORIGIN', message: t('error_invalidOrigin') });
  }

  if (trimmed.includes('*')) {
    throw new MessageError({ code: 'INVALID_ORIGIN', message: t('error_invalidOrigin') });
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new MessageError({ code: 'INVALID_ORIGIN', message: t('error_invalidOrigin') });
  }

  const isLocalhostHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !isLocalhostHttp) {
    throw new MessageError({
      code: 'INVALID_ORIGIN',
      message: t('error_invalidOrigin'),
    });
  }

  return `${url.origin}/*`;
}

registry.register('REQUEST_HOST_PERMISSION', async (payload) => {
  const originPattern = normalizeOriginToHostPattern(payload.origin);
  try {
    return await browser.permissions.request({ origins: [originPattern] });
  } catch {
    return false;
  }
});

registry.register('TEST_PROVIDER_CONNECTION', async (payload) => {
  const originPattern = normalizeOriginToHostPattern(payload.provider.baseUrl);
  let granted = false;
  try {
    granted = await browser.permissions.request({ origins: [originPattern] });
  } catch (error) {
    throw new MessageError({
      code: 'PERMISSION_REQUEST_FAILED',
      message: error instanceof Error ? error.message : 'Could not request host permission',
    });
  }

  if (!granted) {
    throw new MessageError({ code: 'PERMISSION_DENIED', message: 'Permission denied' });
  }

  const provider = new OpenAICompatibleProvider(payload.provider);
  const check = await provider.testConnection();
  if (check.ok) return true as const;

  throw new MessageError({ code: check.error.code, message: check.error.message });
});

registry.register('SELECT_KEYWORDS', async (payload) => {
  const settings = await getSettings();
  const text = payload.text;
  const sourceLang = payload.sourceLang ?? settings.targetLanguage;
  const targetLang = payload.targetLang ?? settings.nativeLanguage;
  const userLevel = payload.userLevel ?? settings.proficiencyLevel;
  const scene = payload.scene ?? 'subtitle';

  const provider = getProvider(settings.provider);
  if (!provider) return [];

  const cacheKey = makeCacheKey('SELECT_KEYWORDS', {
    v: 1,
    provider: { baseUrl: settings.provider?.baseUrl, model: settings.provider?.model },
    prompt: {
      text,
      sourceLang,
      targetLang,
      userLevel,
      scene,
    },
  });

  return getOrRunCachedTask(keywordSelectCache, keywordSelectInFlight, cacheKey, {
    ttlSuccessMs: CACHE_SUCCESS_TTL_MS,
    ttlFallbackMs: CACHE_FALLBACK_TTL_MS,
    run: async () => {
      try {
        const providerConfig = settings.provider;
        if (!providerConfig) return { value: [], ok: false };

        const prompt = buildKeywordSelectPrompt({
          text,
          sourceLang,
          targetLang,
          userLevel,
          scene,
        });

        const response = await runWithModelConcurrency(settings, providerConfig, () =>
          provider.chat([{ role: 'user', content: prompt }], {
            temperature: 0.1,
            maxTokens: 250,
          })
        );

        const responseText = response.choices?.[0]?.message?.content ?? '';
        const parsed = parseKeywordSelectResponse(responseText);
        const filtered = filterSelectedKeywords(parsed.keywords, { userLevel, scene, maxItems: 8 });
        return { value: filtered, ok: parsed.ok };
      } catch {
        return { value: [], ok: false };
      }
    },
  });
});

registry.register('ENHANCE_WEB', async (payload: EnhanceWebPayload) => {
  const settings = await getSettings();
  const content = payload.content;
  const sourceLang = payload.sourceLang ?? settings.targetLanguage;
  const targetLang = payload.targetLang ?? settings.nativeLanguage;
  const defaultRange = getDefaultDifficultyRange(settings.proficiencyLevel);
  const difficultyMin = payload.difficultyMin ?? defaultRange.difficultyMin;
  const difficultyMax = payload.difficultyMax ?? defaultRange.difficultyMax;
  const maxWords = payload.maxWords;

  const provider = getProvider(settings.provider);
  if (!provider) {
    const fallbackResult = validateWebEnhanceOutput(undefined);
    return fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
  }

  const cacheKey = makeCacheKey('ENHANCE_WEB', {
    v: 1,
    provider: { baseUrl: settings.provider?.baseUrl, model: settings.provider?.model },
    prompt: {
      content,
      sourceLang,
      targetLang,
      difficultyMin,
      difficultyMax,
      maxWords: maxWords ?? 15,
    },
  });

  return getOrRunCachedTask(webEnhanceCache, webEnhanceInFlight, cacheKey, {
    ttlSuccessMs: CACHE_SUCCESS_TTL_MS,
    ttlFallbackMs: CACHE_FALLBACK_TTL_MS,
    run: async () => {
      try {
        const providerConfig = settings.provider;
        if (!providerConfig) {
          const fallbackResult = validateWebEnhanceOutput(undefined);
          const fallbackValue = fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
          return { value: fallbackValue, ok: false };
        }

        const prompt = buildWebEnhancePrompt({
          content,
          sourceLang,
          targetLang,
          difficultyMin,
          difficultyMax,
          ...(maxWords !== undefined && { maxWords }),
        });

        const response = await runWithModelConcurrency(settings, providerConfig, () =>
          provider.chat([{ role: 'user', content: prompt }], {
            temperature: 0.2,
            maxTokens: 2000,
          })
        );

        const responseText = response.choices?.[0]?.message?.content ?? '';
        const validated = validateWebEnhanceOutput(responseText);
        const value = validated.ok ? validated.value : validated.fallback;
        return { value, ok: validated.ok };
      } catch {
        const fallbackResult = validateWebEnhanceOutput(undefined);
        const value = fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
        return { value, ok: false };
      }
    },
  });
});

registry.register('ENHANCE_SUBTITLE', async (payload: EnhanceSubtitlePayload) => {
  const settings = await getSettings();
  const subtitle = payload.subtitle;
  const sourceLang = payload.sourceLang ?? settings.targetLanguage;
  const targetLang = payload.targetLang ?? settings.nativeLanguage;
  const difficultyLevel = payload.difficultyLevel ?? settings.proficiencyLevel;
  const mode = payload.mode ?? 'bilingual';

  const provider = getProvider(settings.provider);
  if (!provider) {
    const fallbackResult = validateSubtitleEnhanceOutput(undefined);
    return fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
  }

  const cacheKey = makeCacheKey('ENHANCE_SUBTITLE', {
    v: 1,
    provider: { baseUrl: settings.provider?.baseUrl, model: settings.provider?.model },
    prompt: {
      subtitle,
      sourceLang,
      targetLang,
      difficultyLevel,
      mode,
    },
  });

  return getOrRunCachedTask(subtitleEnhanceCache, subtitleEnhanceInFlight, cacheKey, {
    ttlSuccessMs: CACHE_SUCCESS_TTL_MS,
    ttlFallbackMs: CACHE_FALLBACK_TTL_MS,
    run: async () => {
      try {
        const providerConfig = settings.provider;
        if (!providerConfig) {
          const fallbackResult = validateSubtitleEnhanceOutput(undefined);
          const fallbackValue = fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
          return { value: fallbackValue, ok: false };
        }

        const prompt = buildSubtitleEnhancePrompt({
          subtitle,
          sourceLang,
          targetLang,
          difficultyLevel,
          mode,
        });

        const response = await runWithModelConcurrency(settings, providerConfig, () =>
          provider.chat([{ role: 'user', content: prompt }], {
            temperature: 0.2,
            maxTokens: 400,
          })
        );

        const responseText = response.choices?.[0]?.message?.content ?? '';
        const validated = validateSubtitleEnhanceOutput(responseText);
        const value = validated.ok ? validated.value : validated.fallback;
        return { value, ok: validated.ok };
      } catch {
        const fallbackResult = validateSubtitleEnhanceOutput(undefined);
        const value = fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
        return { value, ok: false };
      }
    },
  });
});

registry.register('EXPLAIN_WORD', async (payload: ExplainWordPayload) => {
  const word = payload.word.trim();
  const context = payload.context?.trim();
  if (!word) {
    throw new MessageError({ code: 'INVALID_PAYLOAD', message: 'Expected payload { word: string }' });
  }

  await recordLookup(word);

  const settings = await getSettings();
  const sourceLang = settings.targetLanguage;
  const targetLang = settings.nativeLanguage;
  const userLevel = settings.proficiencyLevel;

  const cacheKey = makeCacheKey('EXPLAIN_WORD', {
    v: 2,
    provider: { baseUrl: settings.provider?.baseUrl, model: settings.provider?.model },
    word,
    sourceLang,
    targetLang,
    userLevel,
    context: context ?? '',
  });

  const cached = explainWordCache.get(cacheKey);
  if (cached) return cached;

  return dedupeInFlight(explainWordInFlight, cacheKey, async () => {
    // Try offline dictionary first.
    const entry = await dictionaryService.lookup(word);
    if (entry) {
      const definition =
        entry.definitions?.[0]?.definition ??
        entry.definitions?.map((item) => item.definition).filter(Boolean).join('\n') ??
        t('wordCard_definitionUnavailable');

      const normalizedWord = typeof entry.word === 'string' && entry.word.trim() ? entry.word.trim() : word;
      const value: ExplainWordOutput = {
        word: normalizedWord,
        definition: definition.trim() ? definition : t('wordCard_definitionUnavailable'),
        ...(entry.phonetic && entry.phonetic.trim() ? { phonetic: entry.phonetic.trim() } : {}),
        ...(entry.difficulty && entry.difficulty.trim() ? { difficulty: entry.difficulty.trim() } : {}),
      };

      explainWordCache.set(cacheKey, value, CACHE_SUCCESS_TTL_MS);
      return value;
    }

    // Fallback to provider-based explanation.
    const provider = getProvider(settings.provider);
    if (!provider) {
      const value: ExplainWordOutput = { word, definition: t('wordCard_definitionUnavailable') };
      explainWordCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
      return value;
    }

    try {
      const providerConfig = settings.provider;
      if (!providerConfig) {
        const value: ExplainWordOutput = { word, definition: t('wordCard_definitionUnavailable') };
        explainWordCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
        return value;
      }

      const prompt = buildExplainWordPrompt({
        word,
        ...(context ? { context } : {}),
        sourceLang,
        targetLang,
        userLevel,
      });

      const response = await runWithModelConcurrency(settings, providerConfig, () =>
        provider.chat([{ role: 'user', content: prompt }], {
          temperature: 0.2,
          maxTokens: 350,
        })
      );

      const responseText = response.choices?.[0]?.message?.content ?? '';
      const parsed = parseExplainWordResponse(responseText);

      const definition =
        typeof parsed.definition === 'string' && parsed.definition.trim()
          ? parsed.definition.trim()
          : t('wordCard_definitionUnavailable');

      const value: ExplainWordOutput = {
        word,
        definition,
        ...(parsed.translation && parsed.translation.trim() ? { translation: parsed.translation.trim() } : {}),
        ...(parsed.phonetic && parsed.phonetic.trim() ? { phonetic: parsed.phonetic.trim() } : {}),
        ...(parsed.difficulty && parsed.difficulty.trim() ? { difficulty: parsed.difficulty.trim() } : {}),
        ...(parsed.example && parsed.example.trim() ? { example: parsed.example.trim() } : {}),
        ...(parsed.example_translation && parsed.example_translation.trim()
          ? { example_translation: parsed.example_translation.trim() }
          : {}),
      };

      // Persist minimal info for offline reuse.
      try {
        await dictionaryService.upsert({
          word,
          ...(value.phonetic ? { phonetic: value.phonetic } : {}),
          definitions: [{ partOfSpeech: 'AI', definition: value.definition }],
          ...(value.difficulty ? { difficulty: value.difficulty } : {}),
        });
      } catch {
        // ignore
      }

      explainWordCache.set(cacheKey, value, CACHE_SUCCESS_TTL_MS);
      return value;
    } catch {
      const value: ExplainWordOutput = { word, definition: t('wordCard_definitionFailed') };
      explainWordCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
      return value;
    }
  });
});

// =============================================================================
// Chat Session Management
// =============================================================================

interface ChatSession {
  id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  createdAt: number;
  lastAccessedAt: number;
}

const chatSessions = new Map<string, ChatSession>();
const CHAT_SESSIONS_STORAGE_KEY = 'lexipath_chat_sessions_v1';

const ChatSessionSchema = z
  .object({
    id: z.string().min(1),
    messages: z.array(
      z
        .object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
        })
        .strict()
    ),
    createdAt: z.number(),
    lastAccessedAt: z.number(),
  })
  .strict();

const StoredChatSessionsSchema = z
  .object({
    sessions: z.array(ChatSessionSchema),
  })
  .strict();

let chatSessionsLoaded = false;
let chatSessionsLoadPromise: Promise<void> | null = null;
let chatSessionsPersistTimer: ReturnType<typeof setTimeout> | null = null;

const CHAT_SESSION_MAX_COUNT = 10;
const CHAT_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour
const CHAT_MAX_HISTORY_MESSAGES = 20; // Max messages to keep in history (10 pairs)

function generateSessionId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of chatSessions.entries()) {
    if (now - session.lastAccessedAt > CHAT_SESSION_TTL_MS) {
      chatSessions.delete(id);
    }
  }

  if (chatSessions.size > CHAT_SESSION_MAX_COUNT) {
    const sorted = Array.from(chatSessions.entries()).sort(
      (a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt
    );
    const toDelete = sorted.slice(0, chatSessions.size - CHAT_SESSION_MAX_COUNT);
    for (const [id] of toDelete) {
      chatSessions.delete(id);
    }
  }
}

function truncateHistory(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (messages.length <= CHAT_MAX_HISTORY_MESSAGES) {
    return messages;
  }
  return messages.slice(messages.length - CHAT_MAX_HISTORY_MESSAGES);
}

function snapshotChatSessionsForStorage(): ChatSession[] {
  const sessions = Array.from(chatSessions.values())
    .map((session) => ({
      ...session,
      messages: truncateHistory(session.messages),
    }))
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);

  // Persist only what we'd keep in-memory, and ensure max-count.
  return sessions.slice(Math.max(0, sessions.length - CHAT_SESSION_MAX_COUNT));
}

function schedulePersistChatSessions(): void {
  if (chatSessionsPersistTimer !== null) return;
  chatSessionsPersistTimer = setTimeout(() => {
    chatSessionsPersistTimer = null;
    const sessions = snapshotChatSessionsForStorage();
    void browser.storage.local
      .set({ [CHAT_SESSIONS_STORAGE_KEY]: { sessions } })
      .catch(() => {
        // ignore
      });
  }, 250);
}

async function ensureChatSessionsLoaded(): Promise<void> {
  if (chatSessionsLoaded) return;
  if (chatSessionsLoadPromise) return chatSessionsLoadPromise;

  chatSessionsLoadPromise = (async () => {
    try {
      const raw = await browser.storage.local.get(CHAT_SESSIONS_STORAGE_KEY);
      const parsed = StoredChatSessionsSchema.safeParse(raw[CHAT_SESSIONS_STORAGE_KEY]);
      if (parsed.success) {
        for (const session of parsed.data.sessions) {
          chatSessions.set(session.id, session);
        }
      }
    } catch {
      // ignore
    } finally {
      cleanupExpiredSessions();
      chatSessionsLoaded = true;
      schedulePersistChatSessions();
    }
  })();

  return chatSessionsLoadPromise;
}

registry.register('CHAT', async (payload) => {
  await ensureChatSessionsLoaded();
  cleanupExpiredSessions();

  const settings = await getSettings();
  const provider = getProvider(settings.provider);
  if (!provider) {
    throw new MessageError({
      code: 'PROVIDER_NOT_CONFIGURED',
      message: t('error_providerNotConfigured'),
    });
  }

  const sessionId = payload.conversationId ?? generateSessionId();
  let session = chatSessions.get(sessionId);

  if (!session) {
    session = {
      id: sessionId,
      messages: [],
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
    chatSessions.set(sessionId, session);
    schedulePersistChatSessions();
  }

  session.messages.push({
    role: 'user',
    content: payload.message,
  });
  session.messages = truncateHistory(session.messages);
  schedulePersistChatSessions();

  const truncatedHistory = truncateHistory(session.messages);

  const systemMessage = {
    role: 'system' as const,
    content: `You are a helpful language learning assistant. The user's native language is ${settings.nativeLanguage} and they are learning ${settings.targetLanguage} at ${settings.proficiencyLevel} level. Please provide clear, helpful responses in their native language (${settings.nativeLanguage === 'zh-CN' ? 'Simplified Chinese' : settings.nativeLanguage === 'zh-TW' ? 'Traditional Chinese' : 'English'}).`,
  };

  try {
    const providerConfig = settings.provider;
    if (!providerConfig) {
      throw new MessageError({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: t('error_providerNotConfigured'),
      });
    }

    const response = await runWithModelConcurrency(settings, providerConfig, () =>
      provider.chat(
        [systemMessage, ...truncatedHistory],
        {
          temperature: 0.7,
          maxTokens: 1000,
        }
      )
    );

    const assistantReply = response.choices?.[0]?.message?.content ?? '';
    if (!assistantReply) {
      throw new MessageError({
        code: 'EMPTY_RESPONSE',
        message: t('error_emptyResponse'),
      });
    }

    session.messages.push({
      role: 'assistant',
      content: assistantReply,
    });
    session.messages = truncateHistory(session.messages);

    session.lastAccessedAt = Date.now();
    schedulePersistChatSessions();

    return {
      reply: assistantReply,
      conversationId: sessionId,
    };
  } catch (error) {
    session.messages.pop();
    schedulePersistChatSessions();
    throw error;
  }
});

// Register message listener
browser.runtime.onMessage.addListener((message, sender) => {
  // Align with src-extension behavior: content script can query additional params that
  // are only visible on the real timedtext request (starts from `potc` query param).
  if (message && typeof message === 'object') {
    const record = message as Record<string, unknown>;
    if (record.type === 'GET_CAPTION_REQUEST_INFO') {
      const videoId = typeof record.videoId === 'string' ? record.videoId : '';
      const params = videoId ? getCachedYouTubeCaptionParams(videoId) : '';
      return Promise.resolve({ success: true, data: params });
    }
  }

  return registry.handleIncomingMessage(message, sender);
});

// Capture YouTube timedtext requests to obtain additional required params (e.g. potc=...).
// This follows src-extension's approach and avoids guessing YouTube's internal signing.
if (browser.webRequest?.onBeforeRequest?.addListener) {
  console.log('[LexiPath] webRequest available; enabling YouTube timedtext interception');
  browser.webRequest.onBeforeRequest.addListener(
    (details) => {
      try {
        const url = new URL(details.url);
        if (!url.hostname.endsWith('youtube.com')) return;
        if (url.pathname !== '/api/timedtext') return;

        const videoId = url.searchParams.get('v');
        if (!videoId) return;

        const additionalParams = extractYouTubeTimedtextAdditionalParams(url);
        if (!additionalParams) {
          // Useful for debugging: we saw a timedtext request, but it didn't include potc=...
          // Without potc, the content script may not be able to fetch captions reliably.
          console.debug(`[LexiPath] Intercepted YouTube timedtext without potc (videoId=${videoId})`);
          return;
        }

        const existing = youtubeCaptionRequestParams.get(videoId);
        if (existing?.params?.includes('potc=')) {
          youtubeCaptionRequestParams.set(videoId, { params: existing.params, timestamp: Date.now() });
          return;
        }

        youtubeCaptionRequestParams.set(videoId, { params: additionalParams, timestamp: Date.now() });
        console.log(`[LexiPath] Captured YouTube timedtext params for ${videoId}`);

        const tabId = typeof details.tabId === 'number' ? details.tabId : -1;
        if (tabId >= 0 && browser.tabs?.sendMessage) {
          void browser.tabs
            .sendMessage(tabId, {
              type: 'CAPTION_REQUEST_INTERCEPTED',
              data: { videoId, additionalParams },
            })
            .catch(() => {
              // ignore
            });
        }
      } catch {
        // ignore
      }
    },
    { urls: ['*://www.youtube.com/api/timedtext*', '*://youtube.com/api/timedtext*', '*://*.youtube.com/api/timedtext*'] },
    // Match src-extension: requestBody isn't used right now, but requesting it ensures the event options
    // align with the proven implementation.
    ['requestBody']
  );
} else {
  console.warn('[LexiPath] webRequest.onBeforeRequest is unavailable; YouTube subtitle interception disabled');
}

// Log startup
console.log('[LexiPath] Background service worker started');

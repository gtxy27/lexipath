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
  type CEFRLevel,
  type ProviderConfig,
  type SubtitleEnhanceOutput,
  type WebEnhanceOutput,
} from '@lexipath/core';
import { validateSubtitleEnhanceOutput, validateWebEnhanceOutput } from '@lexipath/core/validators';
import { OpenAICompatibleProvider } from '@lexipath/providers';
import {
  buildExplainWordPrompt,
  buildSubtitleEnhancePrompt,
  buildWebEnhancePrompt,
  parseExplainWordResponse,
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

const registry = createMessageHandlerRegistry();

const CACHE_MAX_ENTRIES = 200;
const CACHE_SUCCESS_TTL_MS = 5 * 60 * 1000;
const CACHE_FALLBACK_TTL_MS = 60 * 1000;

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

function coerceWebContent(payload: unknown): string | null {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  const candidates = [record.content, record.text, record.input, record.source];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function coerceSubtitle(payload: unknown): string | null {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  const candidates = [record.subtitle, record.text, record.content, record.input];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function getOptionalPayloadField<T>(
  payload: unknown,
  key: string,
  schema: z.ZodType<T>
): T | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  const value = record[key];
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
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
const explainWordCache = createExpiringLruCache<{
  word: string;
  phonetic?: string;
  definition: string;
  difficulty?: string;
  translation?: string;
  example?: string;
  example_translation?: string;
}>(CACHE_MAX_ENTRIES);
const webEnhanceInFlight = new Map<string, Promise<WebEnhanceOutput>>();
const subtitleEnhanceInFlight = new Map<string, Promise<SubtitleEnhanceOutput>>();
const explainWordInFlight = new Map<
  string,
  Promise<{
    word: string;
    phonetic?: string;
    definition: string;
    difficulty?: string;
    translation?: string;
    example?: string;
    example_translation?: string;
  }>
>();
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

  if (trimmed === '<all_urls>') return '<all_urls>';
  if (trimmed.includes('*')) return trimmed;

  try {
    const url = new URL(trimmed);
    return `${url.origin}/*`;
  } catch {
    return trimmed;
  }
}

registry.register('REQUEST_HOST_PERMISSION', async (payload) => {
  const originPattern = normalizeOriginToHostPattern(payload.origin);
  try {
    return await browser.permissions.request({ origins: [originPattern] });
  } catch {
    return false;
  }
});

registry.register('ENHANCE_WEB', async (payload) => {
  const content = coerceWebContent(payload);
  if (!content) {
    const fallbackResult = validateWebEnhanceOutput(undefined);
    return fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
  }

  const settings = await getSettings();
  const sourceLang = getOptionalPayloadField(payload, 'sourceLang', SupportedLanguageSchema) ?? settings.targetLanguage;
  const targetLang = getOptionalPayloadField(payload, 'targetLang', NativeLanguageSchema) ?? settings.nativeLanguage;
  const defaultRange = getDefaultDifficultyRange(settings.proficiencyLevel);
  const difficultyMin = getOptionalPayloadField(payload, 'difficultyMin', CEFRLevelSchema) ?? defaultRange.difficultyMin;
  const difficultyMax = getOptionalPayloadField(payload, 'difficultyMax', CEFRLevelSchema) ?? defaultRange.difficultyMax;
  const maxWords = getOptionalPayloadField(payload, 'maxWords', z.number().int().min(1).max(50));

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
        const prompt = buildWebEnhancePrompt({
          content,
          sourceLang,
          targetLang,
          difficultyMin,
          difficultyMax,
          ...(maxWords !== undefined && { maxWords }),
        });

        const response = await provider.chat([{ role: 'user', content: prompt }], {
          temperature: 0.2,
          maxTokens: 2000,
        });

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

registry.register('ENHANCE_SUBTITLE', async (payload) => {
  const subtitle = coerceSubtitle(payload);
  if (!subtitle) {
    const fallbackResult = validateSubtitleEnhanceOutput(undefined);
    return fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
  }

  const settings = await getSettings();
  const sourceLang = getOptionalPayloadField(payload, 'sourceLang', SupportedLanguageSchema) ?? settings.targetLanguage;
  const targetLang = getOptionalPayloadField(payload, 'targetLang', NativeLanguageSchema) ?? settings.nativeLanguage;
  const difficultyLevel = getOptionalPayloadField(payload, 'difficultyLevel', CEFRLevelSchema) ?? settings.proficiencyLevel;
  const mode = getOptionalPayloadField(payload, 'mode', z.union([z.literal('single'), z.literal('bilingual')]))
    ?? 'bilingual';

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
        const prompt = buildSubtitleEnhancePrompt({
          subtitle,
          sourceLang,
          targetLang,
          difficultyLevel,
          mode,
        });

        const response = await provider.chat([{ role: 'user', content: prompt }], {
          temperature: 0.2,
          maxTokens: 400,
        });

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

registry.register('EXPLAIN_WORD', async (payload) => {
  const word =
    getOptionalPayloadField(payload, 'word', z.string().min(1)) ??
    (typeof payload === 'string' && payload.trim() ? payload.trim() : undefined);

  const context = getOptionalPayloadField(payload, 'context', z.string().min(1));

  if (!word) {
    throw new MessageError({
      code: 'INVALID_PAYLOAD',
      message: 'Expected payload { word: string }',
    });
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
        'No definition available';

      const value = {
        word: entry.word ?? word,
        ...(entry.phonetic ? { phonetic: entry.phonetic } : {}),
        definition,
        ...(entry.difficulty ? { difficulty: entry.difficulty } : {}),
      };

      explainWordCache.set(cacheKey, value, CACHE_SUCCESS_TTL_MS);
      return value;
    }

    // Fallback to provider-based explanation.
    const provider = getProvider(settings.provider);
    if (!provider) {
      const value = { word, definition: 'No definition available' };
      explainWordCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
      return value;
    }

    try {
      const prompt = buildExplainWordPrompt({
        word,
        ...(context ? { context } : {}),
        sourceLang,
        targetLang,
        userLevel,
      });

      const response = await provider.chat([{ role: 'user', content: prompt }], {
        temperature: 0.2,
        maxTokens: 350,
      });

      const responseText = response.choices?.[0]?.message?.content ?? '';
      const parsed = parseExplainWordResponse(responseText);

      const value = {
        word,
        translation: parsed.translation,
        phonetic: parsed.phonetic,
        difficulty: parsed.difficulty,
        definition: parsed.definition,
        ...(parsed.example ? { example: parsed.example } : {}),
        ...(parsed.example_translation ? { example_translation: parsed.example_translation } : {}),
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
      const value = { word, definition: 'Failed to load definition' };
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

registry.register('CHAT', async (payload) => {
  cleanupExpiredSessions();

  const settings = await getSettings();
  const provider = getProvider(settings.provider);
  if (!provider) {
    throw new MessageError({
      code: 'PROVIDER_NOT_CONFIGURED',
      message: 'Provider not configured',
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
  }

  session.messages.push({
    role: 'user',
    content: payload.message,
  });

  const truncatedHistory = truncateHistory(session.messages);

  const systemMessage = {
    role: 'system' as const,
    content: `You are a helpful language learning assistant. The user's native language is ${settings.nativeLanguage} and they are learning ${settings.targetLanguage} at ${settings.proficiencyLevel} level. Please provide clear, helpful responses in their native language (${settings.nativeLanguage === 'zh-CN' ? 'Simplified Chinese' : settings.nativeLanguage === 'zh-TW' ? 'Traditional Chinese' : 'English'}).`,
  };

  try {
    const response = await provider.chat(
      [systemMessage, ...truncatedHistory],
      {
        temperature: 0.7,
        maxTokens: 1000,
      }
    );

    const assistantReply = response.choices?.[0]?.message?.content ?? '';
    if (!assistantReply) {
      throw new MessageError({
        code: 'EMPTY_RESPONSE',
        message: 'Empty response from provider',
      });
    }

    session.messages.push({
      role: 'assistant',
      content: assistantReply,
    });

    session.lastAccessedAt = Date.now();

    return {
      reply: assistantReply,
      conversationId: sessionId,
    };
  } catch (error) {
    session.messages.pop();
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

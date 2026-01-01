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
  type ProviderConfig,
  type SubtitleEnhanceOutput,
  type WebEnhanceOutput,
} from '@lexipath/core';
import { validateSubtitleEnhanceOutput, validateWebEnhanceOutput } from '@lexipath/core/validators';
import { OpenAICompatibleProvider } from '@lexipath/providers';
import { buildSubtitleEnhancePrompt, buildWebEnhancePrompt } from '@lexipath/providers/prompts';
import { DictionaryService } from '@lexipath/dictionary';

import { MessageError, createMessageHandlerRegistry } from '../shared/messages';
import { recordLookup } from '../shared/familiarity';
import { getSettings, setSettings } from '../shared/storage';

const registry = createMessageHandlerRegistry();

const CACHE_MAX_ENTRIES = 200;
const CACHE_SUCCESS_TTL_MS = 5 * 60 * 1000;
const CACHE_FALLBACK_TTL_MS = 60 * 1000;

type CacheEntry<T> = { value: T; expiresAt: number };

function createExpiringLruCache<T>(maxEntries: number) {
  const entries = new Map<string, CacheEntry<T>>();

  function get(key: string): T | undefined {
    const entry = entries.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      entries.delete(key);
      return undefined;
    }

    entries.delete(key);
    entries.set(key, entry);
    return entry.value;
  }

  function set(key: string, value: T, ttlMs: number) {
    entries.delete(key);
    entries.set(key, { value, expiresAt: Date.now() + ttlMs });

    while (entries.size > maxEntries) {
      const oldestKey = entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      entries.delete(oldestKey);
    }
  }

  return { get, set };
}

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();

  const parts = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(',')}}`;
}

function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function makeCacheKey(type: string, params: Record<string, unknown>): string {
  const json = stableStringify(params);
  return `${type}:${fnv1a32Hex(json)}`;
}

async function dedupeInFlight<T>(
  inFlight: Map<string, Promise<T>>,
  key: string,
  work: () => Promise<T>
): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = work().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
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

const webEnhanceCache = createExpiringLruCache<WebEnhanceOutput>(CACHE_MAX_ENTRIES);
const subtitleEnhanceCache = createExpiringLruCache<SubtitleEnhanceOutput>(CACHE_MAX_ENTRIES);
const webEnhanceInFlight = new Map<string, Promise<WebEnhanceOutput>>();
const subtitleEnhanceInFlight = new Map<string, Promise<SubtitleEnhanceOutput>>();
const dictionaryService = new DictionaryService();

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
  const difficultyMin = getOptionalPayloadField(payload, 'difficultyMin', CEFRLevelSchema) ?? settings.proficiencyLevel;
  const difficultyMax = getOptionalPayloadField(payload, 'difficultyMax', CEFRLevelSchema) ?? settings.proficiencyLevel;
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

  const cached = webEnhanceCache.get(cacheKey);
  if (cached) return cached;

  return dedupeInFlight(webEnhanceInFlight, cacheKey, async () => {
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

      webEnhanceCache.set(cacheKey, value, validated.ok ? CACHE_SUCCESS_TTL_MS : CACHE_FALLBACK_TTL_MS);
      return value;
    } catch {
      const fallbackResult = validateWebEnhanceOutput(undefined);
      const value = fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
      webEnhanceCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
      return value;
    }
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

  const cached = subtitleEnhanceCache.get(cacheKey);
  if (cached) return cached;

  return dedupeInFlight(subtitleEnhanceInFlight, cacheKey, async () => {
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

      subtitleEnhanceCache.set(cacheKey, value, validated.ok ? CACHE_SUCCESS_TTL_MS : CACHE_FALLBACK_TTL_MS);
      return value;
    } catch {
      const fallbackResult = validateSubtitleEnhanceOutput(undefined);
      const value = fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
      subtitleEnhanceCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
      return value;
    }
  });
});

registry.register('EXPLAIN_WORD', async (payload) => {
  const word =
    getOptionalPayloadField(payload, 'word', z.string().min(1)) ??
    (typeof payload === 'string' && payload.trim() ? payload.trim() : undefined);

  if (!word) {
    throw new MessageError({
      code: 'INVALID_PAYLOAD',
      message: 'Expected payload { word: string }',
    });
  }

  await recordLookup(word);

  const entry = await dictionaryService.lookup(word);
  if (!entry) {
    return {
      word,
      definition: 'No definition available',
    };
  }

  const definition =
    entry.definitions?.[0]?.definition ??
    entry.definitions?.map((item) => item.definition).filter(Boolean).join('\n') ??
    'No definition available';

  return {
    word: entry.word ?? word,
    ...(entry.phonetic ? { phonetic: entry.phonetic } : {}),
    definition,
    ...(entry.difficulty ? { difficulty: entry.difficulty } : {}),
  };
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
  return registry.handleIncomingMessage(message, sender);
});

// Log startup
console.log('[LexiPath] Background service worker started');

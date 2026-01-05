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
  ClaudeProviderConfigSchema,
  GeminiProviderConfigSchema,
  ProviderConfigSchema,
  type EnhanceSubtitlePayload,
  type EnhanceWebPayload,
  type CEFRLevel,
  type ClaudeProviderConfig,
  type GeminiProviderConfig,
  type LLMProviderChannel,
  type ProviderConfig,
  type ProviderChannel,
  type RouteConfig,
  type RouteKind,
  type ExplainWordOutput,
  type ExplainWordPayload,
  type Settings,
  type SubtitleEnhanceOutput,
  type WebEnhanceOutput,
  type TranslateKeywordsPayload,
} from '@lexipath/core';
import { validateSubtitleEnhanceOutput } from '@lexipath/core/validators';
import {
  BingTranslateProvider,
  ClaudeProvider,
  GeminiProvider,
  GoogleTranslateProvider,
  OpenAICompatibleProvider,
  WebDAVProvider,
} from '@lexipath/providers';
import {
  buildExplainWordPrompt,
  buildKeywordSelectPrompt,
  buildSubtitleAdaptPrompt,
  buildSubtitleEnhancePrompt,
  buildTermTranslatePrompt,
  buildTranslateKeywordsPrompt,
  buildWebEnhancePrompt,
  parseExplainWordResponse,
  parseKeywordSelectResponse,
  parseTermTranslateResponse,
  parseTranslateKeywordsResponse,
} from '@lexipath/providers/prompts';
import { DictionaryService } from '@lexipath/dictionary';

import { MessageError, createMessageHandlerRegistry } from '../shared/messages';
import { recordLookup } from '../shared/familiarity';
import { getSettings, setSettings } from '../shared/storage';
import { getStorageService } from '../shared/storage-service';
import { parseKeywordSessionId } from '../shared/chat-session-id';
import {
  createExpiringLruCache,
  getOrRunCachedTask,
  makeCacheKey,
  stableStringify,
  dedupeInFlight,
} from './pipeline';
import { filterSelectedKeywords } from './keyword-filter';
import {
  InvalidOriginError,
  normalizeOriginToHostPattern as normalizeOriginToHostPatternCore,
} from './origin';

const registry = createMessageHandlerRegistry();

const CACHE_MAX_ENTRIES = 200;
const CACHE_SUCCESS_TTL_MS = 5 * 60 * 1000;
const CACHE_FALLBACK_TTL_MS = 60 * 1000;
const DEFAULT_CHANNEL_CONCURRENCY = 15;
const GOOGLE_TRANSLATE_CONCURRENCY = 25;
const BING_TRANSLATE_CONCURRENCY = 25;
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

function getChannelConcurrencyLimit(
  channel: ProviderChannel | null,
  kind: RouteKind
): number {
  if (kind === 2) return GOOGLE_TRANSLATE_CONCURRENCY;
  if (kind === 3) return BING_TRANSLATE_CONCURRENCY;
  const raw = channel?.concurrencyLimit;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1) {
    return Math.min(500, Math.floor(raw));
  }
  return DEFAULT_CHANNEL_CONCURRENCY;
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

async function runWithChannelConcurrency<T>(
  routeKey: string,
  limit: number,
  work: () => Promise<T>
): Promise<T> {
  const release = await acquireConcurrencySlot(routeKey, limit);
  try {
    return await work();
  } finally {
    release();
  }
}

type ChatProvider = OpenAICompatibleProvider | ClaudeProvider | GeminiProvider;

const chatProviders = new Map<string, ChatProvider>();

const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1';
const DEFAULT_CLAUDE_URL = 'https://api.anthropic.com/v1';
const DEFAULT_GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';

function providerKey(type: LLMProviderChannel, config: ProviderConfig | ClaudeProviderConfig | GeminiProviderConfig): string {
  return stableStringify({ type, config });
}

function getChatProvider(type: LLMProviderChannel, config: ProviderConfig | ClaudeProviderConfig | GeminiProviderConfig): ChatProvider {
  const key = providerKey(type, config);
  const existing = chatProviders.get(key);
  if (existing) return existing;

  const created: ChatProvider = (() => {
    switch (type) {
      case 'openai':
        return new OpenAICompatibleProvider(config as ProviderConfig);
      case 'claude':
        return new ClaudeProvider(config as ClaudeProviderConfig);
      case 'gemini':
        return new GeminiProvider(config as GeminiProviderConfig);
    }
  })();

  chatProviders.set(key, created);
  return created;
}

const googleTranslateProvider = new GoogleTranslateProvider();
const bingTranslateProvider = new BingTranslateProvider();

type ResolvedRoute = { kind: RouteKind; channelId?: number };

function resolveChannel(channelId: number | undefined, settings: Settings): ProviderChannel | null {
  if (typeof channelId !== 'number' || !Number.isFinite(channelId)) return null;
  return settings.channels.find((channel) => channel.channelId === channelId) ?? null;
}

function firstAvailableChannel(settings: Settings): ProviderChannel | null {
  let best: ProviderChannel | null = null;
  for (const channel of settings.channels) {
    if (!best || channel.channelId < best.channelId) best = channel;
  }
  return best;
}

function fallbackToFirstChannel(settings: Settings): ResolvedRoute {
  const first = firstAvailableChannel(settings);
  return { kind: 1, ...(first ? { channelId: first.channelId } : {}) };
}

function resolveRoute(behaviorKey: string, settings: Settings): ResolvedRoute {
  const config = (settings.behaviorRoutes?.[behaviorKey] ?? null) as RouteConfig | null;
  if (!config) return fallbackToFirstChannel(settings);

  if (config.kind === 2 || config.kind === 3) {
    return { kind: config.kind };
  }

  const channel = resolveChannel(config.channelId, settings);
  if (channel) return { kind: 1, channelId: channel.channelId };
  return fallbackToFirstChannel(settings);
}

function resolveChannelRoute(behaviorKey: string, settings: Settings): ResolvedRoute {
  const resolved = resolveRoute(behaviorKey, settings);
  if (resolved.kind !== 1) return fallbackToFirstChannel(settings);
  if (typeof resolved.channelId === 'number') return resolved;
  return fallbackToFirstChannel(settings);
}

function routeKey(resolved: ResolvedRoute): string {
  if (resolved.kind === 2) return 'google';
  if (resolved.kind === 3) return 'bing';
  return `channel:${resolved.channelId ?? 'none'}`;
}

function routeIdentity(resolved: ResolvedRoute, settings: Settings): Record<string, unknown> {
  if (resolved.kind === 2) return { kind: 'google' };
  if (resolved.kind === 3) return { kind: 'bing' };
  const channel = resolveChannel(resolved.channelId, settings);
  if (!channel) return { kind: 'channel', channelId: resolved.channelId ?? null };
  return {
    kind: 'channel',
    channelId: channel.channelId,
    typeId: channel.typeId,
    model: channel.model,
    baseUrl: typeof (channel.config as any)?.baseUrl === 'string' ? (channel.config as any).baseUrl : '',
  };
}

function llmTypeForChannel(channel: ProviderChannel): LLMProviderChannel | null {
  if (channel.typeId === 1) return 'openai';
  if (channel.typeId === 2) return 'claude';
  if (channel.typeId === 3) return 'gemini';
  return null;
}

function getChatProviderByChannel(
  channel: ProviderChannel
): { type: LLMProviderChannel; config: ProviderConfig | ClaudeProviderConfig | GeminiProviderConfig } | null {
  const type = llmTypeForChannel(channel);
  if (!type) return null;

  const config = channel.config as Record<string, unknown>;
  const customHeaders =
    config.customHeaders && typeof config.customHeaders === 'object' ? (config.customHeaders as Record<string, unknown>) : undefined;
  const normalizedHeaders =
    customHeaders && Object.values(customHeaders).every((value) => typeof value === 'string')
      ? (customHeaders as Record<string, string>)
      : undefined;

  if (type === 'openai') {
    const parsed = ProviderConfigSchema.safeParse({
      baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl : DEFAULT_OPENAI_URL,
      model: channel.model,
      ...(typeof config.apiKey === 'string' ? { apiKey: config.apiKey } : {}),
      ...(normalizedHeaders ? { customHeaders: normalizedHeaders } : {}),
    });
    if (!parsed.success) return null;
    return { type, config: parsed.data };
  }

  if (type === 'claude') {
    const parsed = ClaudeProviderConfigSchema.safeParse({
      model: channel.model,
      apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
      baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl : DEFAULT_CLAUDE_URL,
      ...(normalizedHeaders ? { customHeaders: normalizedHeaders } : {}),
    });
    if (!parsed.success) return null;
    return { type, config: parsed.data };
  }

  const parsed = GeminiProviderConfigSchema.safeParse({
    model: channel.model,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl : DEFAULT_GEMINI_URL,
    ...(normalizedHeaders ? { customHeaders: normalizedHeaders } : {}),
  });
  if (!parsed.success) return null;
  return { type, config: parsed.data };
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
const translateKeywordsCache = createExpiringLruCache<Record<string, string>>(CACHE_MAX_ENTRIES);
const explainWordCache = createExpiringLruCache<ExplainWordOutput>(CACHE_MAX_ENTRIES);
const webEnhanceInFlight = new Map<string, Promise<WebEnhanceOutput>>();
const subtitleEnhanceInFlight = new Map<string, Promise<SubtitleEnhanceOutput>>();
const keywordSelectInFlight = new Map<string, Promise<string[]>>();
const translateKeywordsInFlight = new Map<string, Promise<Record<string, string>>>();
const explainWordInFlight = new Map<string, Promise<ExplainWordOutput>>();
const dictionaryService = new DictionaryService();

async function getKeywordsForText(options: {
  settings: Settings;
  text: string;
  sourceLang: EnhanceWebPayload['sourceLang'];
  targetLang: EnhanceWebPayload['targetLang'];
  userLevel: CEFRLevel;
  scene: 'subtitle' | 'web';
  maxItems?: number;
}): Promise<string[]> {
  const { settings, text, sourceLang, targetLang, userLevel, scene, maxItems } = options;

  const route = resolveChannelRoute('select_keywords', settings);
  const channel = resolveChannel(route.channelId, settings);
  if (!channel) return [];

  const providerInfo = getChatProviderByChannel(channel);
  if (!providerInfo) return [];
  const provider = getChatProvider(providerInfo.type, providerInfo.config);

  const cacheKey = makeCacheKey('SELECT_KEYWORDS', {
    v: 3,
    provider: routeIdentity(route, settings),
    prompt: {
      text,
      sourceLang,
      targetLang,
      userLevel,
      scene,
      proficiencyPreference: settings.proficiencyPreference ?? null,
    },
  });

  return getOrRunCachedTask(keywordSelectCache, keywordSelectInFlight, cacheKey, {
    ttlSuccessMs: CACHE_SUCCESS_TTL_MS,
    ttlFallbackMs: CACHE_FALLBACK_TTL_MS,
    run: async () => {
      try {
         const prompt = buildKeywordSelectPrompt({
           text,
           sourceLang: sourceLang ?? settings.targetLanguage,
           targetLang: targetLang ?? settings.nativeLanguage,
           userLevel,
           scene,
           ...(settings.proficiencyPreference
             ? { proficiencyPreference: settings.proficiencyPreference }
             : {}),
         });

        const limit = getChannelConcurrencyLimit(channel, route.kind);
        const response = await runWithChannelConcurrency(routeKey(route), limit, () =>
          provider.chat([{ role: 'user', content: prompt }], { temperature: 0.1, maxTokens: 250 })
        );

        const responseText = response.choices?.[0]?.message?.content ?? '';
        const parsed = parseKeywordSelectResponse(responseText);
        const filterOptions: { userLevel: CEFRLevel; scene: 'subtitle' | 'web'; maxItems?: number } = {
          userLevel,
          scene,
        };
        if (typeof maxItems === 'number') {
          filterOptions.maxItems = maxItems;
        }
        const filtered = filterSelectedKeywords(parsed.keywords, filterOptions);
        return { value: filtered, ok: parsed.ok };
      } catch {
        return { value: [], ok: false };
      }
    },
  });
}

function splitTranslatedLines(text: string): string[] {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+[.)]\s*/, '').replace(/^[-*]\s*/, '').trim())
    .map((line) => {
      const idx = Math.max(line.lastIndexOf(':'), line.lastIndexOf('：'));
      if (idx <= 0) return line;
      const maybe = line.slice(idx + 1).trim();
      return maybe || line;
    })
    .filter(Boolean);

  return lines;
}

async function translateKeywords(options: {
  settings: Settings;
  keywords: string[];
  context?: string;
  sourceLang: string;
  targetLang: string;
}): Promise<Record<string, string>> {
  const { settings } = options;
  const inputKeywords = options.keywords.map((term) => term.trim()).filter(Boolean);
  if (inputKeywords.length === 0) return {};

  const unique = Array.from(new Set(inputKeywords));
  const normalizedKeywords = unique.slice().sort((a, b) => a.localeCompare(b));

  const route = resolveRoute('translate_keywords', settings);

  const cacheKey = makeCacheKey('TRANSLATE_KEYWORDS', {
    v: 1,
    provider: routeIdentity(route, settings),
    params: {
      keywords: normalizedKeywords.join('|'),
      context: options.context ?? '',
      sourceLang: options.sourceLang,
      targetLang: options.targetLang,
    },
  });

  return getOrRunCachedTask(translateKeywordsCache, translateKeywordsInFlight, cacheKey, {
    ttlSuccessMs: CACHE_SUCCESS_TTL_MS,
    ttlFallbackMs: CACHE_FALLBACK_TTL_MS,
    run: async () => {
      try {
        switch (route.kind) {
          case 1: {
            const channel = resolveChannel(route.channelId, settings);
            if (!channel) return { value: {}, ok: false };
            const providerInfo = getChatProviderByChannel(channel);
            if (!providerInfo) return { value: {}, ok: false };
            const provider = getChatProvider(providerInfo.type, providerInfo.config);

            const prompt = buildTranslateKeywordsPrompt({
              keywords: normalizedKeywords,
              ...(options.context ? { context: options.context } : {}),
              sourceLang: options.sourceLang,
              targetLang: options.targetLang,
            });

            const limit = getChannelConcurrencyLimit(channel, route.kind);
            const response = await runWithChannelConcurrency(routeKey(route), limit, () =>
              provider.chat([{ role: 'user', content: prompt }], { temperature: 0, maxTokens: 400 })
            );

            const responseText = response.choices?.[0]?.message?.content ?? '';
            const parsed = parseTranslateKeywordsResponse(responseText, normalizedKeywords.length);
            if (!parsed.ok) return { value: {}, ok: false };

            const mapping: Record<string, string> = {};
            for (let i = 0; i < normalizedKeywords.length; i++) {
              const keyword = normalizedKeywords[i];
              const translated = parsed.translations[i];
              if (!keyword) continue;
              mapping[keyword] = typeof translated === 'string' && translated.trim() ? translated.trim() : keyword;
            }
            return { value: mapping, ok: true };
          }

          case 2: {
            const inputString = normalizedKeywords.join('\n');
            const limit = getChannelConcurrencyLimit(null, route.kind);
            const output = await runWithChannelConcurrency(routeKey(route), limit, () =>
              googleTranslateProvider.translate(inputString, { from: options.sourceLang, to: options.targetLang })
            );
            const lines = splitTranslatedLines(output);
            if (lines.length !== normalizedKeywords.length) {
              console.warn(
                `[LexiPath] TRANSLATE_KEYWORDS (google) line mismatch expected=${normalizedKeywords.length} got=${lines.length}`
              );
              return { value: {}, ok: false };
            }
            const mapping: Record<string, string> = {};
            for (let i = 0; i < normalizedKeywords.length; i++) {
              const keyword = normalizedKeywords[i];
              const translated = lines[i];
              if (!keyword) continue;
              mapping[keyword] = translated?.trim() ? translated.trim() : keyword;
            }
            return { value: mapping, ok: true };
          }

          case 3: {
            const inputString = normalizedKeywords.join('\n');
            const limit = getChannelConcurrencyLimit(null, route.kind);
            const output = await runWithChannelConcurrency(routeKey(route), limit, () =>
              bingTranslateProvider.translate(inputString, { from: options.sourceLang, to: options.targetLang })
            );
            const lines = splitTranslatedLines(output);
            if (lines.length !== normalizedKeywords.length) {
              console.warn(
                `[LexiPath] TRANSLATE_KEYWORDS (bing) line mismatch expected=${normalizedKeywords.length} got=${lines.length}`
              );
              return { value: {}, ok: false };
            }
            const mapping: Record<string, string> = {};
            for (let i = 0; i < normalizedKeywords.length; i++) {
              const keyword = normalizedKeywords[i];
              const translated = lines[i];
              if (!keyword) continue;
              mapping[keyword] = translated?.trim() ? translated.trim() : keyword;
            }
            return { value: mapping, ok: true };
          }
        }
      } catch {
        // fallthrough
      }
      return { value: {}, ok: false };
    },
  });
}

async function translateTerms(options: {
  settings: Settings;
  terms: string[];
  sourceLang: string;
  targetLang: string;
}): Promise<string[]> {
  const { settings } = options;
  const terms = options.terms.map((term) => term.trim()).filter(Boolean);
  if (terms.length === 0) return [];

  const route = resolveRoute('translate', settings);
  if (route.kind === 2) {
    const limit = getChannelConcurrencyLimit(null, route.kind);
    return runWithChannelConcurrency(routeKey(route), limit, async () =>
      googleTranslateProvider.translateList(terms, { from: options.sourceLang, to: options.targetLang })
    );
  }
  if (route.kind === 3) {
    const limit = getChannelConcurrencyLimit(null, route.kind);
    return runWithChannelConcurrency(routeKey(route), limit, async () =>
      bingTranslateProvider.translateList(terms, { from: options.sourceLang, to: options.targetLang })
    );
  }

  const channel = resolveChannel(route.channelId, settings);
  if (!channel) return terms;
  const providerInfo = getChatProviderByChannel(channel);
  if (!providerInfo) return terms;
  const provider = getChatProvider(providerInfo.type, providerInfo.config);

  const prompt = buildTermTranslatePrompt({
    terms,
    sourceLang: options.sourceLang,
    targetLang: options.targetLang,
  });

  try {
    const limit = getChannelConcurrencyLimit(channel, route.kind);
    const response = await runWithChannelConcurrency(routeKey(route), limit, () =>
      provider.chat([{ role: 'user', content: prompt }], { temperature: 0, maxTokens: 400 })
    );

    const responseText = response.choices?.[0]?.message?.content ?? '';
    const parsed = parseTermTranslateResponse(responseText);
    const translations = parsed.translations;
    return terms.map((term) => translations[term] ?? term);
  } catch {
    return terms;
  }
}

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

registry.register('GET_CHAT_SESSIONS', async (payload) => {
  const storageService = getStorageService();
  if (payload?.keyword) {
    return storageService.getSessionsByKeyword(payload.keyword);
  }
  return storageService.listAllSessions();
});

registry.register('GET_CHAT_MESSAGES', async (payload) => {
  const storageService = getStorageService();
  if (!payload?.sessionId) {
    throw new MessageError({ code: 'INVALID_PAYLOAD', message: 'Expected sessionId' });
  }
  const limitOption = typeof payload.limit === 'number' ? { limit: payload.limit } : {};
  return storageService.getMessages(payload.sessionId, limitOption);
});

registry.register('SET_SETTINGS', async (payload) => {
  await setSettings(payload);
  return null;
});

registry.register('EXPORT_DATA', async () => {
  const storageService = getStorageService();
  return storageService.exportAll();
});

registry.register('IMPORT_DATA', async (payload) => {
  const storageService = getStorageService();
  await storageService.importAll(payload);
  return { ok: true };
});

registry.register('SEARCH_MESSAGES', async (payload) => {
  const storageService = getStorageService();
  const limitOption = typeof payload.limit === 'number' ? { limit: payload.limit } : {};
  return storageService.searchMessages(payload.query, limitOption);
});

registry.register('TEST_WEBDAV_CONNECTION', async (payload) => {
  const provider = new WebDAVProvider(payload);
  const result = await provider.testConnection();
  if (result.ok) return { ok: true };
  throw new MessageError(result.error);
});

registry.register('WEBDAV_UPLOAD', async (payload) => {
  const storageService = getStorageService();
  const data = await storageService.exportAll();
  const provider = new WebDAVProvider(payload);
  const result = await provider.upload(data);
  if (!result.ok) {
    throw new MessageError(result.error);
  }
  return { ok: true };
});

registry.register('WEBDAV_DOWNLOAD', async (payload) => {
  const provider = new WebDAVProvider(payload);
  const result = await provider.download();
  if (!result.ok) {
    throw new MessageError(result.error);
  }
  if (result.value) {
    const storageService = getStorageService();
    await storageService.importAll(result.value, { strategy: 'merge' });
  }
  return { ok: true };
});

function normalizeOriginToHostPattern(origin: string): string {
  try {
    return normalizeOriginToHostPatternCore(origin);
  } catch (error) {
    if (error instanceof InvalidOriginError) {
      throw new MessageError({ code: 'INVALID_ORIGIN', message: t('error_invalidOrigin') });
    }
    throw error;
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

registry.register('TEST_PROVIDER_CONNECTION', async (payload) => {
  const origin = (() => {
    switch (payload.type) {
      case 'openai':
        return payload.config.baseUrl || DEFAULT_OPENAI_URL;
      case 'claude':
        return payload.config.baseUrl ?? DEFAULT_CLAUDE_URL;
      case 'gemini':
        return payload.config.baseUrl ?? DEFAULT_GEMINI_URL;
      case 'google':
        return 'https://translate.googleapis.com';
      case 'bing':
        return 'https://www.bing.com';
    }
  })();

  const originPattern = normalizeOriginToHostPattern(origin);
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

  const check = await (async () => {
    switch (payload.type) {
      case 'openai':
        return new OpenAICompatibleProvider(payload.config).testConnection();
      case 'claude':
        return new ClaudeProvider(payload.config).testConnection();
      case 'gemini':
        return new GeminiProvider(payload.config).testConnection();
      case 'google':
        return googleTranslateProvider.testConnection();
      case 'bing':
        return bingTranslateProvider.testConnection();
    }
  })();

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

  return getKeywordsForText({
    settings,
    text,
    sourceLang,
    targetLang,
    userLevel,
    scene,
  });
});

registry.register('TRANSLATE_KEYWORDS', async (payload: TranslateKeywordsPayload) => {
  const settings = await getSettings();
  const keywords = payload.keywords.map((term) => term.trim()).filter(Boolean);
  if (keywords.length === 0) return [];

  const mapping = await translateKeywords({
    settings,
    keywords,
    ...(payload.context ? { context: payload.context } : {}),
    sourceLang: payload.sourceLang,
    targetLang: payload.targetLang,
  });

  return keywords.map((term) => mapping[term] ?? term);
});

registry.register('ENHANCE_WEB', async (payload: EnhanceWebPayload) => {
  const settings = await getSettings();
  const content = payload.content;
  const sourceLang = payload.sourceLang ?? settings.targetLanguage;
  const targetLang = payload.targetLang ?? settings.nativeLanguage;
  const maxWords = payload.maxWords ?? 15;
  const userLevel = settings.proficiencyLevel;

  const keywordRoute = resolveChannelRoute('select_keywords', settings);
  const translateRoute = resolveRoute('translate', settings);

  const cacheKey = makeCacheKey('ENHANCE_WEB', {
    v: 3,
    providers: {
      keyword: routeIdentity(keywordRoute, settings),
      translation: routeIdentity(translateRoute, settings),
    },
    params: {
      content,
      sourceLang,
      targetLang,
      userLevel,
      maxWords,
    },
  });

  return getOrRunCachedTask(webEnhanceCache, webEnhanceInFlight, cacheKey, {
    ttlSuccessMs: CACHE_SUCCESS_TTL_MS,
    ttlFallbackMs: CACHE_FALLBACK_TTL_MS,
    run: async () => {
      try {
        const keywords = await getKeywordsForText({
          settings,
          text: content,
          sourceLang,
          targetLang,
          userLevel,
          scene: 'web',
          maxItems: maxWords,
        });

        if (!keywords.length) {
          return { value: { content_result: content, convert_word: [] }, ok: false };
        }

        const translations = await translateTerms({
          settings,
          terms: keywords,
          sourceLang: String(sourceLang ?? settings.targetLanguage),
          targetLang: String(targetLang ?? settings.nativeLanguage),
        });

        const convert_word = keywords.map((original, idx) => ({
          original,
          converted: translations[idx] ?? original,
        }));

        return { value: { content_result: content, convert_word }, ok: true };
      } catch {
        return { value: { content_result: content, convert_word: [] }, ok: false };
      }
    },
  });
});

registry.register('ENHANCE_SUBTITLE', async (payload: EnhanceSubtitlePayload) => {
  const settings = await getSettings();
  const subtitle = payload.subtitle;
  const sourceLang = payload.sourceLang ?? settings.targetLanguage;
  const difficultyLevel = payload.difficultyLevel ?? settings.proficiencyLevel;
  const mode = payload.mode ?? 'bilingual';

  const translateRoute = resolveRoute('translate', settings);
  const nativeLang = payload.targetLang ?? settings.nativeLanguage;
  const needsAdapt = sourceLang !== settings.targetLanguage;

  const adaptRoute = needsAdapt ? resolveChannelRoute('adapt_subtitle', settings) : null;
  const adaptChannel = adaptRoute ? resolveChannel(adaptRoute.channelId, settings) : null;
  const adaptProviderInfo = adaptChannel ? getChatProviderByChannel(adaptChannel) : null;

  const cacheKey = makeCacheKey('ENHANCE_SUBTITLE', {
    v: 4,
    providers: {
      ...(needsAdapt
        ? { adapt: routeIdentity(adaptRoute!, settings) }
        : { translation: routeIdentity(translateRoute, settings) }),
    },
    params: {
      subtitle,
      sourceLang,
      targetLang: nativeLang,
      difficultyLevel,
      mode,
      needsAdapt,
    },
  });

  return getOrRunCachedTask(subtitleEnhanceCache, subtitleEnhanceInFlight, cacheKey, {
    ttlSuccessMs: CACHE_SUCCESS_TTL_MS,
    ttlFallbackMs: CACHE_FALLBACK_TTL_MS,
    run: async () => {
      try {
        if (!needsAdapt) {
          if (mode === 'single') {
            return { value: { line1_final: subtitle }, ok: true };
          }

          const translated = await (async () => {
            if (translateRoute.kind === 2) {
              const limit = getChannelConcurrencyLimit(null, translateRoute.kind);
              return runWithChannelConcurrency(routeKey(translateRoute), limit, () =>
                googleTranslateProvider.translate(subtitle, { from: String(sourceLang), to: String(nativeLang) })
              );
            }
            if (translateRoute.kind === 3) {
              const limit = getChannelConcurrencyLimit(null, translateRoute.kind);
              return runWithChannelConcurrency(routeKey(translateRoute), limit, () =>
                bingTranslateProvider.translate(subtitle, { from: String(sourceLang), to: String(nativeLang) })
              );
            }

            const [fallback] = await translateTerms({
              settings,
              terms: [subtitle],
              sourceLang: String(sourceLang),
              targetLang: String(nativeLang),
            });
            return fallback ?? '';
          })();

          return {
            value: { line1_final: subtitle, ...(translated ? { line2_final: translated } : {}) },
            ok: Boolean(translated),
          };
        }

        if (!adaptChannel || !adaptProviderInfo) {
          return { value: { line1_final: subtitle }, ok: false };
        }

        const provider = getChatProvider(adaptProviderInfo.type, adaptProviderInfo.config);

        const prompt = buildSubtitleAdaptPrompt({
          subtitle,
          sourceLang,
          difficultyLevel,
          targetLang: settings.targetLanguage,
          ...(settings.proficiencyPreference
            ? { proficiencyPreference: settings.proficiencyPreference }
            : {}),
        });

        const adaptLimit = getChannelConcurrencyLimit(adaptChannel, adaptRoute!.kind);
        const response = await runWithChannelConcurrency(routeKey(adaptRoute!), adaptLimit, () =>
          provider.chat([{ role: 'user', content: prompt }], {
            temperature: 0.2,
            maxTokens: 350,
          })
        );

        const responseText = response.choices?.[0]?.message?.content ?? '';
        const validated = validateSubtitleEnhanceOutput(responseText);
        const baseValue = validated.ok ? validated.value : validated.fallback;
        const value =
          mode === 'bilingual'
            ? { ...baseValue, ...(subtitle.trim() ? { line2_final: subtitle } : {}) }
            : baseValue;
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

  const dictionaryRoute = resolveRoute('dictionary', settings);
  const dictionaryChannel = dictionaryRoute.kind === 1 ? resolveChannel(dictionaryRoute.channelId, settings) : null;
  const dictionaryProviderInfo = dictionaryChannel ? getChatProviderByChannel(dictionaryChannel) : null;

  const cacheKey = makeCacheKey('EXPLAIN_WORD', {
    v: 4,
    provider: routeIdentity(dictionaryRoute, settings),
    word,
    sourceLang,
    targetLang,
    userLevel,
    proficiencyPreference: settings.proficiencyPreference ?? null,
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
    if (dictionaryRoute.kind === 2 || dictionaryRoute.kind === 3) {
      try {
        const limit = getChannelConcurrencyLimit(null, dictionaryRoute.kind);
        const translated = await runWithChannelConcurrency(routeKey(dictionaryRoute), limit, () =>
          dictionaryRoute.kind === 2
            ? googleTranslateProvider.translate(word, { from: String(sourceLang), to: String(targetLang) })
            : bingTranslateProvider.translate(word, { from: String(sourceLang), to: String(targetLang) })
        );

        const definition = translated?.trim() ? translated.trim() : t('wordCard_definitionUnavailable');
        const value: ExplainWordOutput = {
          word,
          definition,
          ...(translated?.trim() ? { translation: translated.trim() } : {}),
        };
        explainWordCache.set(cacheKey, value, translated?.trim() ? CACHE_SUCCESS_TTL_MS : CACHE_FALLBACK_TTL_MS);
        return value;
      } catch {
        const value: ExplainWordOutput = { word, definition: t('wordCard_definitionUnavailable') };
        explainWordCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
        return value;
      }
    }

    if (!dictionaryProviderInfo) {
      const value: ExplainWordOutput = { word, definition: t('wordCard_definitionUnavailable') };
      explainWordCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
      return value;
    }

    try {
      const provider = getChatProvider(dictionaryProviderInfo.type, dictionaryProviderInfo.config);

      const prompt = buildExplainWordPrompt({
        word,
        ...(context ? { context } : {}),
        sourceLang,
        targetLang,
        userLevel,
        ...(settings.proficiencyPreference
          ? { proficiencyPreference: settings.proficiencyPreference }
          : {}),
      });

      const limit = getChannelConcurrencyLimit(dictionaryChannel, dictionaryRoute.kind);
      const response = await runWithChannelConcurrency(routeKey(dictionaryRoute), limit, () =>
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

const CHAT_SESSIONS_LEGACY_STORAGE_KEY = 'lexipath_chat_sessions_v1';
const CHAT_MAX_HISTORY_MESSAGES = 20; // Max messages to keep in prompt history (10 pairs)

const LegacyChatSessionSchema = z
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

const LegacyStoredChatSessionsSchema = z
  .object({
    sessions: z.array(LegacyChatSessionSchema),
  })
  .strict();

let chatMigrationPromise: Promise<void> | null = null;

async function ensureChatMigrated(): Promise<void> {
  if (chatMigrationPromise) return chatMigrationPromise;

  chatMigrationPromise = (async () => {
    const storageService = getStorageService();

    try {
      const already = await storageService.getMeta('migration_chat_v1');
      if (already) return;
    } catch {
      // ignore
    }

    try {
      const raw = await browser.storage.local.get(CHAT_SESSIONS_LEGACY_STORAGE_KEY);
      const parsed = LegacyStoredChatSessionsSchema.safeParse(raw[CHAT_SESSIONS_LEGACY_STORAGE_KEY]);
      if (parsed.success) {
        for (const session of parsed.data.sessions) {
          await storageService.upsertSession({
            sessionId: session.id,
            keyword: '',
            conversationIndex: 0,
            createdAt: session.createdAt,
            lastAccessedAt: session.lastAccessedAt,
          });

          const baseTimestamp = session.createdAt || Date.now();
          for (const [idx, msg] of session.messages.entries()) {
            await storageService.addMessageWithoutTouchingSession({
              sessionId: session.id,
              role: msg.role,
              content: msg.content,
              timestamp: baseTimestamp + idx,
            });
          }
        }
      }
    } catch {
      // ignore
    }

    try {
      await browser.storage.local.remove(CHAT_SESSIONS_LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }

    try {
      await storageService.setMeta('migration_chat_v1', true);
    } catch {
      // ignore
    }
  })().finally(() => {
    chatMigrationPromise = null;
  });

  return chatMigrationPromise;
}

function generateSessionId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}
type StructuredStreamError = { code: string; message: string };

function toStructuredStreamError(error: unknown): StructuredStreamError {
  if (error instanceof MessageError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: error.message || t('error_unknown') };
  }
  return { code: 'INTERNAL_ERROR', message: t('error_unknown') };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function parseSseStream(
  response: Response,
  options: { onData: (data: string) => void; signal?: AbortSignal }
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    if (options.signal?.aborted) break;
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const lines = part.split(/\r?\n/);
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      const data = dataLines.join('\n').trim();
      if (data) options.onData(data);
    }
  }
}

async function streamOpenAICompatibleChat(options: {
  config: ProviderConfig;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const baseUrl = options.config.baseUrl ?? DEFAULT_OPENAI_URL;
  const url = joinUrl(baseUrl, '/chat/completions');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.config.customHeaders,
  };
  if (options.config.apiKey) {
    headers['Authorization'] = `Bearer ${options.config.apiKey}`;
  }

  const body = {
    model: options.config.model,
    messages: options.messages,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new MessageError({ code: 'PROVIDER_ERROR', message: `Provider error: ${response.status} - ${errorText}` });
  }

  let accumulated = '';
  await parseSseStream(response, {
    ...(options.signal ? { signal: options.signal } : {}),
    onData: (data) => {
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const delta =
          parsed?.choices?.[0]?.delta?.content ??
          parsed?.choices?.[0]?.delta?.text ??
          parsed?.choices?.[0]?.message?.content ??
          '';
        if (typeof delta === 'string' && delta) {
          accumulated += delta;
          options.onDelta(delta);
        }
      } catch {
        // ignore malformed chunks
      }
    },
  });

  return accumulated;
}

function extractClaudeSystemPrompt(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const systemParts: string[] = [];
  const output: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) systemParts.push(message.content.trim());
      continue;
    }
    if (message.role === 'user' || message.role === 'assistant') {
      output.push({ role: message.role, content: message.content });
    }
  }

  return { ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}), messages: output };
}

const ANTHROPIC_VERSION = '2023-06-01';

async function streamClaudeChat(options: {
  config: ClaudeProviderConfig;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const baseUrl = options.config.baseUrl ?? DEFAULT_CLAUDE_URL;
  const url = joinUrl(baseUrl, '/messages');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    'x-api-key': options.config.apiKey,
    ...options.config.customHeaders,
  };

  const { system, messages } = extractClaudeSystemPrompt(options.messages);
  const body: Record<string, unknown> = {
    model: options.config.model,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
    stream: true,
    ...(system ? { system } : {}),
    messages,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new MessageError({ code: 'PROVIDER_ERROR', message: `Provider error: ${response.status} - ${errorText}` });
  }

  let accumulated = '';
  await parseSseStream(response, {
    ...(options.signal ? { signal: options.signal } : {}),
    onData: (data) => {
      try {
        const parsed = JSON.parse(data);
        const type = typeof parsed?.type === 'string' ? parsed.type : '';
        if (type === 'content_block_delta') {
          const delta = parsed?.delta?.text;
          if (typeof delta === 'string' && delta) {
            accumulated += delta;
            options.onDelta(delta);
          }
          return;
        }
        if (type === 'content_block_start') {
          const text = parsed?.content_block?.text;
          if (typeof text === 'string' && text) {
            accumulated += text;
            options.onDelta(text);
          }
        }
      } catch {
        // ignore
      }
    },
  });

  return accumulated;
}

function normalizeGeminiModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes('/')) return trimmed;
  return `models/${trimmed}`;
}

function extractGeminiPrompts(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): {
  systemInstruction?: string;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
} {
  const systemParts: string[] = [];
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) systemParts.push(message.content.trim());
      continue;
    }
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content }] });
      continue;
    }
    if (message.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: message.content }] });
      continue;
    }
  }

  const systemInstruction = systemParts.length ? systemParts.join('\n\n') : undefined;
  return { ...(systemInstruction ? { systemInstruction } : {}), contents };
}

async function streamGeminiChat(options: {
  config: GeminiProviderConfig;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const baseUrl = options.config.baseUrl ?? DEFAULT_GEMINI_URL;
  const model = normalizeGeminiModel(options.config.model);
  const url = new URL(joinUrl(baseUrl, `${model}:streamGenerateContent`));
  url.searchParams.set('key', options.config.apiKey);
  url.searchParams.set('alt', 'sse');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.config.customHeaders,
  };

  const { systemInstruction, contents } = extractGeminiPrompts(options.messages);
  const body: Record<string, unknown> = {
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    contents,
    generationConfig: {
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
    },
  };

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new MessageError({ code: 'PROVIDER_ERROR', message: `Provider error: ${response.status} - ${errorText}` });
  }

  let accumulated = '';
  await parseSseStream(response, {
    ...(options.signal ? { signal: options.signal } : {}),
    onData: (data) => {
      try {
        const parsed = JSON.parse(data);
        const candidates = parsed?.candidates;
        if (!Array.isArray(candidates) || candidates.length === 0) return;
        const content = candidates[0]?.content;
        const parts = content?.parts;
        if (!Array.isArray(parts)) return;
        let text = '';
        for (const part of parts) {
          const chunk = part?.text;
          if (typeof chunk === 'string') text += chunk;
        }

        if (!text) return;
        const delta = text.startsWith(accumulated) ? text.slice(accumulated.length) : text;
        if (!delta) return;
        accumulated += delta;
        options.onDelta(delta);
      } catch {
        // ignore
      }
    },
  });

  return accumulated;
}

async function runChatStream(
  payload: { message: string; conversationId?: string },
  options: { onDelta: (delta: string) => void; signal?: AbortSignal }
): Promise<{ reply: string; conversationId: string }> {
  await ensureChatMigrated();

  const settings = await getSettings();
  const chatRoute = resolveChannelRoute('chat', settings);
  const chatChannel = resolveChannel(chatRoute.channelId, settings);
  const chatProviderInfo = chatChannel ? getChatProviderByChannel(chatChannel) : null;
  if (!chatChannel || !chatProviderInfo) {
    throw new MessageError({
      code: 'PROVIDER_NOT_CONFIGURED',
      message: t('error_providerNotConfigured'),
    });
  }

  const sessionId = payload.conversationId ?? generateSessionId();
  const parsedSessionId = parseKeywordSessionId(sessionId);
  const storageService = getStorageService();
  const now = Date.now();

  const existing = await storageService.getSession(sessionId);
  if (!existing) {
    await storageService.upsertSession({
      sessionId,
      keyword: parsedSessionId?.keyword ?? '',
      conversationIndex: parsedSessionId?.conversationIndex ?? 0,
      createdAt: now,
      lastAccessedAt: now,
    });
  }

  const userMessageId = await storageService.addMessage({
    sessionId,
    role: 'user',
    content: payload.message,
    timestamp: now,
  });

  const history = await storageService.getMessages(sessionId, { limit: CHAT_MAX_HISTORY_MESSAGES });

  const systemMessage = {
    role: 'system' as const,
    content: `You are a helpful language learning assistant. The user's native language is ${settings.nativeLanguage} and they are learning ${settings.targetLanguage} at ${settings.proficiencyLevel} level. Please provide clear, helpful responses in their native language (${settings.nativeLanguage === 'zh-CN' ? 'Simplified Chinese' : settings.nativeLanguage === 'zh-TW' ? 'Traditional Chinese' : 'English'}).`,
  };

  try {
    const limit = getChannelConcurrencyLimit(chatChannel, chatRoute.kind);
    const reply = await runWithChannelConcurrency(routeKey(chatRoute), limit, () => {
      const messages = [systemMessage, ...history.map((m) => ({ role: m.role, content: m.content }))] as Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
      }>;

      switch (chatProviderInfo.type) {
        case 'openai':
          return streamOpenAICompatibleChat({
            config: chatProviderInfo.config as ProviderConfig,
            messages,
            temperature: 0.7,
            maxTokens: 1000,
            onDelta: options.onDelta,
            ...(options.signal ? { signal: options.signal } : {}),
          });
        case 'claude':
          return streamClaudeChat({
            config: chatProviderInfo.config as ClaudeProviderConfig,
            messages,
            temperature: 0.7,
            maxTokens: 1000,
            onDelta: options.onDelta,
            ...(options.signal ? { signal: options.signal } : {}),
          });
        case 'gemini':
          return streamGeminiChat({
            config: chatProviderInfo.config as GeminiProviderConfig,
            messages,
            temperature: 0.7,
            maxTokens: 1000,
            onDelta: options.onDelta,
            ...(options.signal ? { signal: options.signal } : {}),
          });
      }
    });

    const assistantReply = reply ?? '';
    if (!assistantReply.trim()) {
      throw new MessageError({
        code: 'EMPTY_RESPONSE',
        message: t('error_emptyResponse'),
      });
    }

    await storageService.addMessage({
      sessionId,
      role: 'assistant',
      content: assistantReply,
      timestamp: Date.now(),
    });

    return { reply: assistantReply, conversationId: sessionId };
  } catch (error) {
    try {
      await storageService.deleteMessage(userMessageId);
    } catch {
      // ignore
    }
    throw error;
  }
}

registry.register('CHAT', async (payload) => {
  let reply = '';
  const result = await runChatStream(
    {
      message: payload.message,
      ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
    },
    {
    onDelta: (delta) => {
      reply += delta;
    },
    }
  );
  return { reply: result.reply || reply, conversationId: result.conversationId };
});

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== 'LEXIPATH_CHAT_STREAM') return;

  let started = false;

  port.onMessage.addListener((message) => {
    if (started) return;
    if (!message || typeof message !== 'object') return;
    const record = message as any;
    if (record.type !== 'START' || !record.payload) return;
    const payload = record.payload as { message?: string; conversationId?: string };
    if (typeof payload.message !== 'string' || !payload.message.trim()) return;
    const startMessage: string = payload.message;
    const startConversationId = payload.conversationId;

    started = true;

    void (async () => {
      try {
        let reply = '';
        const result = await runChatStream(
          { message: startMessage, ...(startConversationId ? { conversationId: startConversationId } : {}) },
          {
            onDelta: (delta) => {
              reply += delta;
              try {
                port.postMessage({ type: 'CHUNK', delta });
              } catch {
                // ignore
              }
            },
          }
        );

        try {
          port.postMessage({
            type: 'DONE',
            reply: result.reply || reply,
            conversationId: result.conversationId,
          });
        } catch {
          // ignore
        }
      } catch (error) {
        const structured = toStructuredStreamError(error);
        try {
          port.postMessage({ type: 'ERROR', error: structured });
        } catch {
          // ignore
        }
      } finally {
        try {
          port.disconnect();
        } catch {
          // ignore
        }
      }
    })();
  });
});

// =============================================================================
// Side Panel and Context Menu Management
// =============================================================================

async function openSidePanel(tabId?: number) {
  if (typeof (browser as any).sidePanel?.open === 'function') {
    await (browser as any).sidePanel.open({ tabId });
  }
}

registry.register('OPEN_SIDEBAR', async (payload, sender) => {
  await openSidePanel(sender?.tab?.id);
  if (payload?.initialMessage) {
    // We'll store the initial message in local storage so the sidebar can read it on mount
    await browser.storage.local.set({ 
      lexipath_sidebar_pending_message: {
        text: payload.initialMessage,
        keyword: typeof payload.keyword === 'string' ? payload.keyword : undefined,
        timestamp: Date.now(),
        isAutoSend: payload.isAutoSend ?? false
      } 
    });
  }
  return { ok: true };
});

// Set up Context Menus
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: 'lexipath-explain-selection',
    title: t('contextMenu_explainSelection'),
    contexts: ['selection'],
  });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'lexipath-explain-selection' && info.selectionText) {
    const selectedText = info.selectionText.trim();
    if (!selectedText) return;

    // Use the prompt builder logic indirectly or just send the raw text
    const prompt = `Please explain this sentence or phrase: "${selectedText}"`;
    
    await openSidePanel(tab?.id);
    await browser.storage.local.set({ 
      lexipath_sidebar_pending_message: {
        text: prompt,
        timestamp: Date.now(),
        isAutoSend: true
      } 
    });
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

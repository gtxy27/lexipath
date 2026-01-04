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
} from '@lexipath/core';
import { validateSubtitleEnhanceOutput } from '@lexipath/core/validators';
import {
  BingTranslateProvider,
  ClaudeProvider,
  GeminiProvider,
  GoogleTranslateProvider,
  OpenAICompatibleProvider,
} from '@lexipath/providers';
import {
  buildExplainWordPrompt,
  buildKeywordSelectPrompt,
  buildSubtitleEnhancePrompt,
  buildTermTranslatePrompt,
  buildWebEnhancePrompt,
  parseExplainWordResponse,
  parseKeywordSelectResponse,
  parseTermTranslateResponse,
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
const explainWordCache = createExpiringLruCache<ExplainWordOutput>(CACHE_MAX_ENTRIES);
const webEnhanceInFlight = new Map<string, Promise<WebEnhanceOutput>>();
const subtitleEnhanceInFlight = new Map<string, Promise<SubtitleEnhanceOutput>>();
const keywordSelectInFlight = new Map<string, Promise<string[]>>();
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

registry.register('SET_SETTINGS', async (payload) => {
  await setSettings(payload);
  return null;
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
  const targetLang = payload.targetLang ?? settings.nativeLanguage;
  const difficultyLevel = payload.difficultyLevel ?? settings.proficiencyLevel;
  const mode = payload.mode ?? 'bilingual';

  const enhanceRoute = resolveChannelRoute('enhance_subtitle', settings);
  const enhanceChannel = resolveChannel(enhanceRoute.channelId, settings);
  const enhanceProviderInfo = enhanceChannel ? getChatProviderByChannel(enhanceChannel) : null;
  const translateRoute = resolveRoute('translate', settings);

  const cacheKey = makeCacheKey('ENHANCE_SUBTITLE', {
    v: 3,
    providers: {
      enhance: routeIdentity(enhanceRoute, settings),
      translation: routeIdentity(translateRoute, settings),
    },
    params: {
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
        if (!enhanceChannel || !enhanceProviderInfo) {
          if (mode === 'bilingual') {
            const translated = await (async () => {
              if (translateRoute.kind === 2) {
                const limit = getChannelConcurrencyLimit(null, translateRoute.kind);
                return runWithChannelConcurrency(routeKey(translateRoute), limit, () =>
                  googleTranslateProvider.translate(subtitle, { from: String(sourceLang), to: String(targetLang) })
                );
              }
              if (translateRoute.kind === 3) {
                const limit = getChannelConcurrencyLimit(null, translateRoute.kind);
                return runWithChannelConcurrency(routeKey(translateRoute), limit, () =>
                  bingTranslateProvider.translate(subtitle, { from: String(sourceLang), to: String(targetLang) })
                );
              }

              const [fallback] = await translateTerms({
                settings,
                terms: [subtitle],
                sourceLang: String(sourceLang),
                targetLang: String(targetLang),
              });
              return fallback ?? '';
            })();

            return {
              value: { line1_final: subtitle, ...(translated ? { line2_final: translated } : {}) },
              ok: Boolean(translated),
            };
          }

          return { value: { line1_final: subtitle }, ok: false };
        }

        const provider = getChatProvider(enhanceProviderInfo.type, enhanceProviderInfo.config);

        if (mode === 'bilingual' && (translateRoute.kind === 2 || translateRoute.kind === 3)) {
          const prompt = buildSubtitleEnhancePrompt({
            subtitle,
            sourceLang,
            targetLang,
            difficultyLevel,
            mode: 'single',
          });

          const enhanceLimit = getChannelConcurrencyLimit(enhanceChannel, enhanceRoute.kind);
          const response = await runWithChannelConcurrency(routeKey(enhanceRoute), enhanceLimit, () =>
            provider.chat([{ role: 'user', content: prompt }], {
              temperature: 0.2,
              maxTokens: 300,
            })
          );

          const responseText = response.choices?.[0]?.message?.content ?? '';
          const validated = validateSubtitleEnhanceOutput(responseText);
          const enhancedLine = validated.ok ? validated.value.line1_final : subtitle;

          const translated = await (async () => {
            if (translateRoute.kind === 2) {
              const limit = getChannelConcurrencyLimit(null, translateRoute.kind);
              return runWithChannelConcurrency(routeKey(translateRoute), limit, () =>
                googleTranslateProvider.translate(enhancedLine, { from: String(sourceLang), to: String(targetLang) })
              );
            }
            if (translateRoute.kind === 3) {
              const limit = getChannelConcurrencyLimit(null, translateRoute.kind);
              return runWithChannelConcurrency(routeKey(translateRoute), limit, () =>
                bingTranslateProvider.translate(enhancedLine, { from: String(sourceLang), to: String(targetLang) })
              );
            }
            return '';
          })();

          return {
            value: { line1_final: enhancedLine, ...(translated ? { line2_final: translated } : {}) },
            ok: Boolean(translated),
          };
        }

        const prompt = buildSubtitleEnhancePrompt({
          subtitle,
          sourceLang,
          targetLang,
          difficultyLevel,
          mode,
        });

        const enhanceLimit = getChannelConcurrencyLimit(enhanceChannel, enhanceRoute.kind);
        const response = await runWithChannelConcurrency(routeKey(enhanceRoute), enhanceLimit, () =>
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
  const chatRoute = resolveChannelRoute('chat', settings);
  const chatChannel = resolveChannel(chatRoute.channelId, settings);
  const chatProviderInfo = chatChannel ? getChatProviderByChannel(chatChannel) : null;
  if (!chatChannel || !chatProviderInfo) {
    throw new MessageError({
      code: 'PROVIDER_NOT_CONFIGURED',
      message: t('error_providerNotConfigured'),
    });
  }

  const provider = getChatProvider(chatProviderInfo.type, chatProviderInfo.config);

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
    const limit = getChannelConcurrencyLimit(chatChannel, chatRoute.kind);
    const response = await runWithChannelConcurrency(routeKey(chatRoute), limit, () =>
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

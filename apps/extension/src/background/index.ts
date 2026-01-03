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
  ClaudeProviderConfigSchema,
  GeminiProviderConfigSchema,
  LLMProviderChannelSchema,
  NativeLanguageSchema,
  ProviderConfigSchema,
  SupportedLanguageSchema,
  TranslationProviderSchema,
  type EnhanceSubtitlePayload,
  type EnhanceWebPayload,
  type CEFRLevel,
  type ClaudeProviderConfig,
  type GeminiProviderConfig,
  type LLMProviderChannel,
  type ProviderConfig,
  type ExplainWordOutput,
  type ExplainWordPayload,
  type TranslationProvider,
  type Settings,
  type SubtitleEnhanceOutput,
  type WebEnhanceOutput,
} from '@lexipath/core';
import { validateSubtitleEnhanceOutput, validateWebEnhanceOutput } from '@lexipath/core/validators';
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

function getChannelConcurrencyLimit(
  settings: { channelConcurrencyLimits?: Partial<Record<TranslationProvider, number | undefined>> },
  channel: TranslationProvider
): number {
  const raw = settings.channelConcurrencyLimits?.[channel];
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

async function runWithChannelConcurrency<T>(
  settings: { channelConcurrencyLimits?: Partial<Record<TranslationProvider, number | undefined>> },
  channel: TranslationProvider,
  work: () => Promise<T>
): Promise<T> {
  const limit = getChannelConcurrencyLimit(settings, channel);
  const release = await acquireConcurrencySlot(channel, limit);
  try {
    return await work();
  } finally {
    release();
  }
}

type ChatProvider = OpenAICompatibleProvider | ClaudeProvider | GeminiProvider;

const chatProviders = new Map<string, ChatProvider>();

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

function isLLMProvider(type: TranslationProvider): type is LLMProviderChannel {
  return type === 'openai' || type === 'claude' || type === 'gemini';
}

function getChatProviderConfig(
  settings: Settings,
  channel: LLMProviderChannel
): ProviderConfig | ClaudeProviderConfig | GeminiProviderConfig | null {
  switch (channel) {
    case 'openai': {
      const raw = settings.channels.openai;
      if (!raw) return null;
      const parsed = ProviderConfigSchema.safeParse(raw);
      if (!parsed.success) return null;
      return parsed.data;
    }
    case 'claude': {
      const raw = settings.channels.claude;
      if (!raw) return null;
      const parsed = ClaudeProviderConfigSchema.safeParse(raw);
      if (!parsed.success) return null;
      return parsed.data;
    }
    case 'gemini': {
      const raw = settings.channels.gemini;
      if (!raw) return null;
      const parsed = GeminiProviderConfigSchema.safeParse(raw);
      if (!parsed.success) return null;
      return parsed.data;
    }
  }
}

function providerIdentity(type: TranslationProvider, settings: Settings): Record<string, unknown> {
  if (type === 'openai') {
    return {
      type,
      baseUrl: settings.channels.openai?.baseUrl ?? '',
      model: settings.channels.openai?.model ?? '',
    };
  }
  if (type === 'claude') {
    return { type, model: settings.channels.claude?.model ?? '' };
  }
  if (type === 'gemini') {
    return { type, model: settings.channels.gemini?.model ?? '' };
  }
  return { type };
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

  const channel = settings.keywordProvider;
  const providerConfig = getChatProviderConfig(settings, channel);
  if (!providerConfig) return [];

  const provider = getChatProvider(channel, providerConfig);

  const cacheKey = makeCacheKey('SELECT_KEYWORDS', {
    v: 2,
    provider: providerIdentity(channel, settings),
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

        const response = await runWithChannelConcurrency(settings, channel, () =>
          provider.chat([{ role: 'user', content: prompt }], {
            temperature: 0.1,
            maxTokens: 250,
          })
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
  const translationProvider = settings.translationProvider;
  const terms = options.terms.map((term) => term.trim()).filter(Boolean);
  if (terms.length === 0) return [];

  if (translationProvider === 'google') {
    return runWithChannelConcurrency(settings, 'google', async () =>
      googleTranslateProvider.translateList(terms, { from: options.sourceLang, to: options.targetLang })
    );
  }
  if (translationProvider === 'bing') {
    return runWithChannelConcurrency(settings, 'bing', async () =>
      bingTranslateProvider.translateList(terms, { from: options.sourceLang, to: options.targetLang })
    );
  }

  if (!isLLMProvider(translationProvider)) {
    return terms;
  }

  const providerConfig = getChatProviderConfig(settings, translationProvider);
  if (!providerConfig) return terms;
  const provider = getChatProvider(translationProvider, providerConfig);

  const prompt = buildTermTranslatePrompt({
    terms,
    sourceLang: options.sourceLang,
    targetLang: options.targetLang,
  });

  try {
    const response = await runWithChannelConcurrency(settings, translationProvider, () =>
      provider.chat([{ role: 'user', content: prompt }], {
        temperature: 0,
        maxTokens: 400,
      })
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
  const origin = (() => {
    switch (payload.type) {
      case 'openai':
        return payload.config.baseUrl;
      case 'claude':
        return payload.config.baseUrl ?? 'https://api.anthropic.com/v1';
      case 'gemini':
        return payload.config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
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

  const cacheKey = makeCacheKey('ENHANCE_WEB', {
    v: 2,
    providers: {
      keyword: providerIdentity(settings.keywordProvider, settings),
      translation: providerIdentity(settings.translationProvider, settings),
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

  const translationProvider = settings.translationProvider;
  const enhanceChannel: LLMProviderChannel | null = isLLMProvider(translationProvider)
    ? translationProvider
    : settings.keywordProvider;
  const enhanceConfig = enhanceChannel ? getChatProviderConfig(settings, enhanceChannel) : null;

  const cacheKey = makeCacheKey('ENHANCE_SUBTITLE', {
    v: 2,
    providers: {
      enhance: enhanceChannel ? providerIdentity(enhanceChannel, settings) : { type: 'none' },
      translation: providerIdentity(translationProvider, settings),
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
        if (!enhanceChannel || !enhanceConfig) {
          if (mode === 'bilingual') {
            const translated = await (async () => {
              if (translationProvider === 'google') {
                return runWithChannelConcurrency(settings, 'google', () =>
                  googleTranslateProvider.translate(subtitle, { from: String(sourceLang), to: String(targetLang) })
                );
              }
              if (translationProvider === 'bing') {
                return runWithChannelConcurrency(settings, 'bing', () =>
                  bingTranslateProvider.translate(subtitle, { from: String(sourceLang), to: String(targetLang) })
                );
              }
              return '';
            })();

            return {
              value: { line1_final: subtitle, ...(translated ? { line2_final: translated } : {}) },
              ok: Boolean(translated),
            };
          }

          return { value: { line1_final: subtitle }, ok: false };
        }

        const provider = getChatProvider(enhanceChannel, enhanceConfig);

        if (mode === 'bilingual' && !isLLMProvider(translationProvider)) {
          const prompt = buildSubtitleEnhancePrompt({
            subtitle,
            sourceLang,
            targetLang,
            difficultyLevel,
            mode: 'single',
          });

          const response = await runWithChannelConcurrency(settings, enhanceChannel, () =>
            provider.chat([{ role: 'user', content: prompt }], {
              temperature: 0.2,
              maxTokens: 300,
            })
          );

          const responseText = response.choices?.[0]?.message?.content ?? '';
          const validated = validateSubtitleEnhanceOutput(responseText);
          const enhancedLine = validated.ok ? validated.value.line1_final : subtitle;

          const translated = await (async () => {
            if (translationProvider === 'google') {
              return runWithChannelConcurrency(settings, 'google', () =>
                googleTranslateProvider.translate(enhancedLine, { from: String(sourceLang), to: String(targetLang) })
              );
            }
            if (translationProvider === 'bing') {
              return runWithChannelConcurrency(settings, 'bing', () =>
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

        const response = await runWithChannelConcurrency(settings, enhanceChannel, () =>
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
  const llmChannel: LLMProviderChannel = isLLMProvider(settings.translationProvider)
    ? settings.translationProvider
    : settings.keywordProvider;
  const llmConfig = getChatProviderConfig(settings, llmChannel);

  const cacheKey = makeCacheKey('EXPLAIN_WORD', {
    v: 3,
    provider: providerIdentity(llmChannel, settings),
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
    if (!llmConfig) {
      const value: ExplainWordOutput = { word, definition: t('wordCard_definitionUnavailable') };
      explainWordCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
      return value;
    }

    try {
      const provider = getChatProvider(llmChannel, llmConfig);

      const prompt = buildExplainWordPrompt({
        word,
        ...(context ? { context } : {}),
        sourceLang,
        targetLang,
        userLevel,
      });

      const response = await runWithChannelConcurrency(settings, llmChannel, () =>
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
  const llmChannel: LLMProviderChannel = isLLMProvider(settings.translationProvider)
    ? settings.translationProvider
    : settings.keywordProvider;
  const llmConfig = getChatProviderConfig(settings, llmChannel);
  if (!llmConfig) {
    throw new MessageError({
      code: 'PROVIDER_NOT_CONFIGURED',
      message: t('error_providerNotConfigured'),
    });
  }

  const provider = getChatProvider(llmChannel, llmConfig);

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
    const response = await runWithChannelConcurrency(settings, llmChannel, () =>
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

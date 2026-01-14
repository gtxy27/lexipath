import type {
  CEFRLevel,
  EnhanceSubtitlePayload,
  EnhanceWebPayload,
  EnglishCorrectionOutput,
  EnglishCorrectionPayload,
  ExplainWordOutput,
  ExplainWordPayload,
  Settings,
  SubtitleEnhanceOutput,
  TranslateKeywordsPayload,
  WebEnhanceOutput,
} from '@lexipath/core';
import { NativeLanguageSchema, SupportedLanguageSchema, buildHighlightOffsets } from '@lexipath/core';
import { getErrorMessage } from '@lexipath/core/log';
import {
  buildPrompt,
  buildProficiencyRangeReferenceLine,
  buildProficiencyReferenceLine,
  parseExplainWordResponse,
  parseKeywordSelectResponse,
  parseTermTranslateResponse,
  parseTranslateKeywordsResponse,
} from '@lexipath/core/prompting';
import {
  validateEnglishCorrectionOutput,
  validateEnglishCorrectionOutputDetailed,
  validateSubtitleEnhanceOutput,
  validateWebEnhanceOutput,
} from '@lexipath/core/validators';

import { MessageError, type createMessageHandlerRegistry } from '../../shared/messages';
import { recordLookupManual } from '../../shared/familiarity';
import { getSettings } from '../../shared/storage';

import type { createConcurrencyManager } from '../lib/concurrency';
import type { Translator } from '../lib/i18n';
import { bingTranslateProvider, getChatProvider, googleTranslateProvider } from '../lib/providers';
import {
  getChatProviderByChannel,
  resolveChannel,
  resolveChannelRoute,
  resolveRoute,
  routeIdentity,
  routeKey,
} from '../lib/routing';
import { makeContextInfoFromText, makePromptUserInfo, nextCefrLevel, pickStyleKey } from '../lib/prompt';
import { dictionaryService } from '../services/dictionary';
import { createExpiringLruCache, dedupeInFlight, getOrRunCachedTask, makeCacheKey } from '../pipeline';
import { bumpDailyUsage } from '../usage-summary';
import { filterSelectedKeywords } from '../keyword-filter';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;
type ConcurrencyManager = ReturnType<typeof createConcurrencyManager>;

const CACHE_MAX_ENTRIES = 200;
const CACHE_SUCCESS_TTL_MS = 5 * 60 * 1000;
const CACHE_FALLBACK_TTL_MS = 60 * 1000;

const webEnhanceCache = createExpiringLruCache<WebEnhanceOutput>(CACHE_MAX_ENTRIES);
const subtitleEnhanceCache = createExpiringLruCache<SubtitleEnhanceOutput>(CACHE_MAX_ENTRIES);
const keywordSelectCache = createExpiringLruCache<string[]>(CACHE_MAX_ENTRIES);
const translateKeywordsCache = createExpiringLruCache<Record<string, string>>(CACHE_MAX_ENTRIES);
const explainWordCache = createExpiringLruCache<ExplainWordOutput>(CACHE_MAX_ENTRIES);
const englishCorrectionCache = createExpiringLruCache<EnglishCorrectionOutput>(CACHE_MAX_ENTRIES);

const webEnhanceInFlight = new Map<string, Promise<WebEnhanceOutput>>();
const subtitleEnhanceInFlight = new Map<string, Promise<SubtitleEnhanceOutput>>();
const keywordSelectInFlight = new Map<string, Promise<string[]>>();
const translateKeywordsInFlight = new Map<string, Promise<Record<string, string>>>();
const explainWordInFlight = new Map<string, Promise<ExplainWordOutput>>();
const englishCorrectionInFlight = new Map<string, Promise<EnglishCorrectionOutput>>();

function countSentences(text: string): number {
  const parts = text
    .replace(/\s+/g, ' ')
    .split(/[.!?。！？]+/g)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length;
}

function uniqueTokenRatio(text: string): number {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/g)
    .filter(Boolean);
  if (tokens.length === 0) return 1;
  const unique = new Set(tokens);
  return unique.size / tokens.length;
}

function hasRepeatedSentence(text: string): boolean {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/[.!?。！？]+/g)
    .map((p) => p.trim())
    .filter(Boolean);
  if (sentences.length < 4) return false;
  let streak = 1;
  for (let i = 1; i < sentences.length; i += 1) {
    const current = sentences[i];
    const prev = sentences[i - 1];
    if (!current || !prev) continue;
    if (current.toLowerCase() === prev.toLowerCase()) {
      streak += 1;
      if (streak > 2) return true;
    } else {
      streak = 1;
    }
  }
  return false;
}

function cjkRatio(text: string): number {
  const total = text.length;
  if (!total) return 0;
  let cjk = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
      (code >= 0xac00 && code <= 0xd7af) // Hangul
    ) {
      cjk += 1;
    }
  }
  return cjk / total;
}

function countScriptLetters(text: string): { latin: number; han: number; kana: number; hangul: number } {
  let latin = 0;
  let han = 0;
  let kana = 0;
  let hangul = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin += 1;
    else if (code >= 0x4e00 && code <= 0x9fff) han += 1;
    else if (code >= 0x3040 && code <= 0x30ff) kana += 1;
    else if (code >= 0xac00 && code <= 0xd7af) hangul += 1;
  }
  return { latin, han, kana, hangul };
}

function countNonWhitespaceChars(text: string): number {
  return text.replace(/\s+/g, '').length;
}

function extractHardTokens(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_]+/g) ?? [];
  return matches.map((m) => m.trim()).filter(Boolean);
}

function hardTokenFidelity(original: string, rewritten: string): { ok: boolean; missing: number; total: number } {
  const tokens = extractHardTokens(original);
  if (tokens.length === 0) return { ok: true, missing: 0, total: 0 };
  const missing = tokens.filter((t) => !rewritten.includes(t)).length;
  return { ok: missing <= Math.max(1, Math.floor(tokens.length * 0.1)), missing, total: tokens.length };
}

function hasBanPhrases(text: string): boolean {
  const hay = text.toLowerCase();
  return (
    hay.includes('as an ai') ||
    hay.includes('as a language model') ||
    hay.includes('i can’t') ||
    hay.includes("i can't") ||
    hay.includes('i cannot')
  );
}

function validateFullRewriteGuard(options: { original: string; rewritten: string }): { ok: boolean; reason: string } {
  const original = options.original.trim();
  const rewritten = options.rewritten.trim();
  if (!original || !rewritten) return { ok: false, reason: 'empty' };

  const oLen = countNonWhitespaceChars(original);
  const rLen = countNonWhitespaceChars(rewritten);
  if (oLen >= 60 && (rLen < Math.floor(oLen * 0.5) || rLen > Math.ceil(oLen * 2.2))) {
    return { ok: false, reason: 'length_drift' };
  }

  if (hasBanPhrases(rewritten)) {
    return { ok: false, reason: 'ban_phrase' };
  }

  const { latin: oLatin, han: oHan, kana: oKana, hangul: oHangul } = countScriptLetters(original);
  const { latin: rLatin, han: rHan, kana: rKana, hangul: rHangul } = countScriptLetters(rewritten);
  const oCjk = oHan + oKana + oHangul;
  const rCjk = rHan + rKana + rHangul;
  if (oCjk > oLatin && rCjk > rLatin) {
    return { ok: false, reason: 'unexpected_script' };
  }

  const fidelity = hardTokenFidelity(original, rewritten);
  if (!fidelity.ok) {
    return { ok: false, reason: 'hard_token_missing' };
  }

  if (uniqueTokenRatio(rewritten) < 0.22 && rewritten.length > 160) {
    return { ok: false, reason: 'low_diversity' };
  }

  if (hasRepeatedSentence(rewritten)) {
    return { ok: false, reason: 'repeated_sentence' };
  }

  const s1 = countSentences(original);
  const s2 = countSentences(rewritten);
  if (s1 >= 3 && (s2 < Math.floor(s1 * 0.5) || s2 > Math.ceil(s1 * 2.0))) {
    return { ok: false, reason: 'sentence_count_drift' };
  }

  if (cjkRatio(rewritten) > 0.15) {
    return { ok: false, reason: 'cjk_ratio' };
  }

  return { ok: true, reason: 'ok' };
}

type EnglishCorrectionStats = {
  requestsTotal: number;
  providerFailures: number;
  validatedOk: number;
  validatedFallback: number;
  fallbackReasons: Record<string, number>;
  hasErrorTrue: number;
  hasErrorFalse: number;
};

const englishCorrectionStats: EnglishCorrectionStats = {
  requestsTotal: 0,
  providerFailures: 0,
  validatedOk: 0,
  validatedFallback: 0,
  fallbackReasons: {},
  hasErrorTrue: 0,
  hasErrorFalse: 0,
};

(globalThis as any).__lexipathEnglishCorrectionStats = englishCorrectionStats;

async function getKeywordsForText(options: {
  settings: Settings;
  text: string;
  sourceLang: EnhanceWebPayload['sourceLang'];
  targetLang: EnhanceWebPayload['targetLang'];
  userLevel: CEFRLevel;
  scene: 'subtitle' | 'web';
  maxItems?: number;
  contextBefore?: string[];
  contextAfter?: string[];
  t: Translator;
  log: { warn: (...args: any[]) => void };
  concurrency: Pick<ConcurrencyManager, 'getChannelConcurrencyLimit' | 'runWithChannelConcurrency'>;
}): Promise<string[]> {
  const { settings, text, sourceLang, targetLang, userLevel, scene, maxItems, concurrency, log } = options;

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
      contextBefore: options.contextBefore ?? [],
      contextAfter: options.contextAfter ?? [],
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
        const resolvedSourceLang = sourceLang ?? settings.targetLanguage;
        const resolvedTargetLang = targetLang ?? settings.nativeLanguage;
        const referenceLine = buildProficiencyReferenceLine({
          sourceLang: resolvedSourceLang,
          targetLang: resolvedTargetLang,
          userLevel,
          ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
        });

        const userInfo = makePromptUserInfo({
          motherTongue: resolvedTargetLang,
          targetLearningLanguage: resolvedSourceLang,
          cefrLevel: userLevel,
          ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
        });

        const prompt = buildPrompt({
          agentKey: 'keyword_select',
          sceneKey: scene === 'web' ? 'keyword_select_web' : 'keyword_select_subtitle',
          userInfo,
          ...((options.contextBefore?.length ?? 0) > 0 || (options.contextAfter?.length ?? 0) > 0
            ? { contextInfo: { before: options.contextBefore ?? [], after: options.contextAfter ?? [] } }
            : {}),
          userInput: text,
        });

        const limit = concurrency.getChannelConcurrencyLimit(channel, route.kind);
        const response = await concurrency.runWithChannelConcurrency(routeKey(route), limit, () =>
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
      } catch (error: unknown) {
        log.warn('SELECT_KEYWORDS failed; returning empty list', {
          error,
          sourceLang: sourceLang ?? settings.targetLanguage,
          targetLang: targetLang ?? settings.nativeLanguage,
          userLevel,
          scene,
          maxItems,
        });
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

async function translateTerms(options: {
  settings: Settings;
  terms: string[];
  sourceLang: string;
  targetLang: string;
  concurrency: Pick<ConcurrencyManager, 'getChannelConcurrencyLimit' | 'runWithChannelConcurrency'>;
  log: { warn: (...args: any[]) => void };
  /**
   * When false, translation failures return empty strings (per term) instead of falling back to the original input.
   * This is useful for UI flows that want to show an i18n loading state rather than duplicated original text.
   */
  fallbackToOriginal?: boolean;
}): Promise<string[]> {
  const { settings, concurrency, log } = options;
  const fallbackToOriginal = options.fallbackToOriginal !== false;
  const terms = options.terms.map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) return [];

  const route = resolveRoute('translate', settings);
  if (route.kind === 2 || route.kind === 3) {
    const translated: string[] = [];
    for (const term of terms) {
      const limit = concurrency.getChannelConcurrencyLimit(null, route.kind);
      const value = await concurrency.runWithChannelConcurrency(routeKey(route), limit, () =>
        route.kind === 2
          ? googleTranslateProvider.translate(term, { from: String(options.sourceLang), to: String(options.targetLang) })
          : bingTranslateProvider.translate(term, { from: String(options.sourceLang), to: String(options.targetLang) })
      );
      translated.push(value ?? (fallbackToOriginal ? term : ''));
    }
    return translated;
  }

  const channel = resolveChannel(route.channelId, settings);
  if (!channel) return terms.map((term) => (fallbackToOriginal ? term : ''));

  const providerInfo = getChatProviderByChannel(channel);
  if (!providerInfo) return terms.map((term) => (fallbackToOriginal ? term : ''));
  const provider = getChatProvider(providerInfo.type, providerInfo.config);

  const parsedSourceLang = SupportedLanguageSchema.safeParse(options.sourceLang);
  const parsedTargetLang = NativeLanguageSchema.safeParse(options.targetLang);
  if (!parsedSourceLang.success || !parsedTargetLang.success) return terms.map((term) => (fallbackToOriginal ? term : ''));

  const referenceLine = buildProficiencyReferenceLine({
    sourceLang: parsedSourceLang.data,
    targetLang: parsedTargetLang.data,
    userLevel: settings.proficiencyLevel,
    ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
  });

  const userInfo = makePromptUserInfo({
    motherTongue: parsedTargetLang.data,
    targetLearningLanguage: parsedSourceLang.data,
    cefrLevel: settings.proficiencyLevel,
    ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
  });

  const userInput = terms.join('\n');
  const prompt = buildPrompt({
    agentKey: 'term_translate',
    sceneKey: 'term_translate',
    userInfo,
    userInput,
  });

  try {
    const limit = concurrency.getChannelConcurrencyLimit(channel, route.kind);
    const response = await concurrency.runWithChannelConcurrency(routeKey(route), limit, () =>
      provider.chat([{ role: 'user', content: prompt }], { temperature: 0, maxTokens: 400 })
    );

    const responseText = response.choices?.[0]?.message?.content ?? '';

    const parsedJson = parseTermTranslateResponse(responseText);
    if (parsedJson.ok && Object.keys(parsedJson.translations).length > 0) {
      return terms.map((term) => parsedJson.translations[term] ?? (fallbackToOriginal ? term : ''));
    }

    const parsedLines = parseTranslateKeywordsResponse(responseText, terms.length);
    if (parsedLines.ok && parsedLines.translations.length === terms.length) {
      return terms.map((term, index) => {
        const value = parsedLines.translations[index];
        if (typeof value === 'string' && value.trim()) return value.trim();
        return fallbackToOriginal ? term : '';
      });
    }

    return terms.map((term) => (fallbackToOriginal ? term : ''));
  } catch (error: unknown) {
    log.warn('TRANSLATE_TERMS failed; returning original terms', error);
    return terms.map((term) => (fallbackToOriginal ? term : ''));
  }
}

async function translateKeywords(options: {
  settings: Settings;
  keywords: string[];
  context?: string;
  contextBefore?: string[];
  contextAfter?: string[];
  sourceLang: string;
  targetLang: string;
  concurrency: Pick<ConcurrencyManager, 'getChannelConcurrencyLimit' | 'runWithChannelConcurrency'>;
  log: { warn: (...args: any[]) => void };
}): Promise<Record<string, string>> {
  const { settings, concurrency, log } = options;
  const inputKeywords = options.keywords.map((term) => term.trim()).filter(Boolean);
  if (inputKeywords.length === 0) return {};

  const unique = Array.from(new Set(inputKeywords));
  const normalizedKeywords = unique.slice().sort((a, b) => a.localeCompare(b));

  const route = resolveRoute('translate_keywords', settings);

  const fallbackViaTranslateRoute = async (): Promise<{ value: Record<string, string>; ok: boolean }> => {
    try {
      const translated = await translateTerms({
        settings,
        terms: normalizedKeywords,
        sourceLang: options.sourceLang,
        targetLang: options.targetLang,
        concurrency,
        log,
      });
      if (translated.length !== normalizedKeywords.length) return { value: {}, ok: false };
      const mapping: Record<string, string> = {};
      for (let i = 0; i < normalizedKeywords.length; i++) {
        const keyword = normalizedKeywords[i];
        if (!keyword) continue;
        const value = typeof translated[i] === 'string' && translated[i]!.trim() ? translated[i]!.trim() : keyword;
        mapping[keyword] = value;
      }
      return { value: mapping, ok: true };
    } catch (error: unknown) {
      log.warn('TRANSLATE_KEYWORDS fallback via translate route failed', error);
      return { value: {}, ok: false };
    }
  };

  const cacheKey = makeCacheKey('TRANSLATE_KEYWORDS', {
    v: 1,
    provider: routeIdentity(route, settings),
    params: {
      keywords: normalizedKeywords.join('|'),
      context: options.context ?? '',
      contextBefore: (options.contextBefore ?? []).join('\n'),
      contextAfter: (options.contextAfter ?? []).join('\n'),
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
            if (!channel) return fallbackViaTranslateRoute();
            const providerInfo = getChatProviderByChannel(channel);
            if (!providerInfo) return fallbackViaTranslateRoute();
            const provider = getChatProvider(providerInfo.type, providerInfo.config);

            const parsedSourceLang = SupportedLanguageSchema.safeParse(options.sourceLang);
            const parsedTargetLang = NativeLanguageSchema.safeParse(options.targetLang);
            if (!parsedSourceLang.success || !parsedTargetLang.success) {
              return fallbackViaTranslateRoute();
            }

            const referenceLine = buildProficiencyReferenceLine({
              sourceLang: parsedSourceLang.data,
              targetLang: parsedTargetLang.data,
              userLevel: settings.proficiencyLevel,
              ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
            });

            const userInfo = makePromptUserInfo({
              motherTongue: parsedTargetLang.data,
              targetLearningLanguage: parsedSourceLang.data,
              cefrLevel: settings.proficiencyLevel,
              ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
            });

            const userInput = normalizedKeywords.join('\n');

            const prompt = buildPrompt({
              agentKey: 'translate_keywords',
              sceneKey: 'keyword_translate',
              userInfo,
              ...(options.context
                ? { contextInfo: makeContextInfoFromText(options.context) }
                : ((options.contextBefore?.length ?? 0) > 0 || (options.contextAfter?.length ?? 0) > 0
                    ? { contextInfo: { before: options.contextBefore ?? [], after: options.contextAfter ?? [] } }
                    : {})),
              userInput,
            });

            const limit = concurrency.getChannelConcurrencyLimit(channel, route.kind);
            const response = await concurrency.runWithChannelConcurrency(routeKey(route), limit, () =>
              provider.chat([{ role: 'user', content: prompt }], {
                temperature: 0,
                maxTokens: 450,
              })
            );

            const responseText = response.choices?.[0]?.message?.content ?? '';
            const parsed = parseTranslateKeywordsResponse(responseText, normalizedKeywords.length);

            if (!parsed.ok || parsed.translations.length !== normalizedKeywords.length) {
              return fallbackViaTranslateRoute();
            }

            const mapping: Record<string, string> = {};
            for (let i = 0; i < normalizedKeywords.length; i += 1) {
              const keyword = normalizedKeywords[i];
              if (!keyword) continue;
              const translated = parsed.translations[i];
              const value = typeof translated === 'string' && translated.trim() ? translated.trim() : keyword;
              mapping[keyword] = value;
            }

            return { value: mapping, ok: true };
          }
          case 2:
          case 3: {
            const mapping: Record<string, string> = {};
            for (const keyword of normalizedKeywords) {
              const text = keyword.trim();
              if (!text) continue;
              try {
                const limit = concurrency.getChannelConcurrencyLimit(null, route.kind);
                const translated = await concurrency.runWithChannelConcurrency(routeKey(route), limit, () =>
                  route.kind === 2
                    ? googleTranslateProvider.translate(text, { from: String(options.sourceLang), to: String(options.targetLang) })
                    : bingTranslateProvider.translate(text, { from: String(options.sourceLang), to: String(options.targetLang) })
                );
                mapping[keyword] = translated?.trim() ? translated.trim() : keyword;
              } catch (error: unknown) {
                log.warn('TRANSLATE_KEYWORDS direct translate failed; keeping original keyword', { keyword, error });
                mapping[keyword] = keyword;
              }
            }
            return { value: mapping, ok: true };
          }
        }
      } catch (error: unknown) {
        log.warn('TRANSLATE_KEYWORDS failed; using fallback', error);
        return fallbackViaTranslateRoute();
      }
    },
  });
}

export function registerLearningFeature(options: {
  registry: Registry;
  t: Translator;
  log: { warn: (...args: any[]) => void; debug: (...args: any[]) => void };
  concurrency: Pick<ConcurrencyManager, 'getChannelConcurrencyLimit' | 'runWithChannelConcurrency'>;
}) {
  const { registry, t, log, concurrency } = options;

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
      ...(payload.contextBefore ? { contextBefore: payload.contextBefore } : {}),
      ...(payload.contextAfter ? { contextAfter: payload.contextAfter } : {}),
      t,
      log,
      concurrency,
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
      ...(payload.contextBefore ? { contextBefore: payload.contextBefore } : {}),
      ...(payload.contextAfter ? { contextAfter: payload.contextAfter } : {}),
      sourceLang: payload.sourceLang,
      targetLang: payload.targetLang,
      concurrency,
      log,
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
    const mode = payload.mode ?? settings.webEnhanceMode ?? 'i_plus_1';

    const keywordRoute = resolveChannelRoute('select_keywords', settings);
    const translateRoute = resolveRoute('translate', settings);

    const algorithm = mode !== 'full' && translateRoute.kind === 1 ? 'prompt' : 'pipeline';

    const cacheKey = makeCacheKey('ENHANCE_WEB', {
      v: 5,
      algo: algorithm,
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
        mode,
      },
    });

    return getOrRunCachedTask(webEnhanceCache, webEnhanceInFlight, cacheKey, {
      ttlSuccessMs: CACHE_SUCCESS_TTL_MS,
      ttlFallbackMs: CACHE_FALLBACK_TTL_MS,
      run: async () => {
        try {
          const translateText = async (options: {
            text: string;
            sourceLang: EnhanceWebPayload['sourceLang'];
            targetLang: EnhanceWebPayload['targetLang'];
          }): Promise<string> => {
            const text = options.text.trim();
            if (!text) return '';

            if (translateRoute.kind === 2) {
              const limit = concurrency.getChannelConcurrencyLimit(null, translateRoute.kind);
              return concurrency.runWithChannelConcurrency(routeKey(translateRoute), limit, () =>
                googleTranslateProvider.translate(text, {
                  from: String(options.sourceLang ?? settings.targetLanguage),
                  to: String(options.targetLang ?? settings.nativeLanguage),
                })
              );
            }

            if (translateRoute.kind === 3) {
              const limit = concurrency.getChannelConcurrencyLimit(null, translateRoute.kind);
              return concurrency.runWithChannelConcurrency(routeKey(translateRoute), limit, () =>
                bingTranslateProvider.translate(text, {
                  from: String(options.sourceLang ?? settings.targetLanguage),
                  to: String(options.targetLang ?? settings.nativeLanguage),
                })
              );
            }

            const [translated] = await translateTerms({
              settings,
              terms: [text],
              sourceLang: String(options.sourceLang ?? settings.targetLanguage),
              targetLang: String(options.targetLang ?? settings.nativeLanguage),
              concurrency,
              log,
            });
            return translated ?? '';
          };

          const filterConvertWordByHits = <T extends { original: string }>(text: string, words: T[]): T[] => {
            const haystack = text.toLowerCase();
            return words.filter((word) => {
              const needle = word.original.trim().toLowerCase();
              if (!needle) return false;
              return haystack.includes(needle);
            });
          };

          const runKeywordEnhance = async (options: {
            text: string;
            sourceLang: EnhanceWebPayload['sourceLang'];
            targetLang: EnhanceWebPayload['targetLang'];
            maxWords: number;
          }) => {
            const keywords = await getKeywordsForText({
              settings,
              text: options.text,
              sourceLang: options.sourceLang,
              targetLang: options.targetLang,
              userLevel,
              scene: 'web',
              maxItems: options.maxWords,
              t,
              log,
              concurrency,
            });

            if (!keywords.length) {
              return {
                content_result: options.text,
                convert_word: [],
                highlight_terms: [] as string[],
                highlight_offsets: [] as Array<{ start: number; end: number; term: string }>,
              };
            }

            const translations = await translateTerms({
              settings,
              terms: keywords,
              sourceLang: String(options.sourceLang ?? settings.targetLanguage),
              targetLang: String(options.targetLang ?? settings.nativeLanguage),
              concurrency,
              log,
            });

            const dictEntries = await dictionaryService.batchLookup(keywords);
            const convert_word = filterConvertWordByHits(
              options.text,
              keywords.map((original, idx) => {
                const converted = translations[idx] ?? original;
                const entry = dictEntries[idx];
                const difficulty = typeof entry?.difficulty === 'string' ? entry.difficulty.trim() : '';
                const normalizedDifficulty = difficulty.toUpperCase();
                const difficultyLevel = (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).includes(
                  normalizedDifficulty as any
                )
                  ? (normalizedDifficulty as CEFRLevel)
                  : undefined;
                const partOfSpeech =
                  typeof entry?.definitions?.[0]?.partOfSpeech === 'string'
                    ? entry.definitions[0].partOfSpeech
                    : undefined;

                return {
                  original,
                  converted,
                  ...(difficulty ? { difficulty } : {}),
                  ...(difficultyLevel ? { difficultyLevel } : {}),
                  ...(typeof entry?.difficulty === 'string'
                    ? { difficultyConfidence: difficultyLevel ? 0.9 : 0.4 }
                    : { difficultyConfidence: 0.2 }),
                  ...(partOfSpeech ? { partOfSpeech } : {}),
                };
              })
            );

            const highlight_terms = convert_word.map((entry) => entry.original);
            const highlight_offsets = buildHighlightOffsets(options.text, highlight_terms);
            return { content_result: options.text, convert_word, highlight_terms, highlight_offsets };
          };

          const runPromptEnhance = async (options: {
            text: string;
            sourceLang: EnhanceWebPayload['sourceLang'];
            targetLang: EnhanceWebPayload['targetLang'];
            maxWords: number;
          }) => {
            const resolvedRoute = translateRoute.kind === 1 ? translateRoute : keywordRoute;
            const channel = resolveChannel(resolvedRoute.channelId, settings);
            if (!channel) {
              return runKeywordEnhance(options);
            }

            const providerInfo = getChatProviderByChannel(channel);
            if (!providerInfo) {
              return runKeywordEnhance(options);
            }

            const provider = getChatProvider(providerInfo.type, providerInfo.config);
            const difficultyMin = userLevel;
            const difficultyMax = nextCefrLevel(userLevel);

            try {
              const resolvedSourceLang = String(options.sourceLang ?? settings.targetLanguage) as any;
              const resolvedTargetLang = String(options.targetLang ?? settings.nativeLanguage) as any;

              const referenceLine = buildProficiencyRangeReferenceLine({
                sourceLang: resolvedSourceLang,
                targetLang: resolvedTargetLang,
                difficultyMin,
                difficultyMax,
                ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
              });

              const userInfo = makePromptUserInfo({
                motherTongue: resolvedTargetLang,
                targetLearningLanguage: resolvedSourceLang,
                cefrLevel: difficultyMax,
                ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
              });

              const userInput = options.text;

              const prompt = buildPrompt({
                agentKey: 'web_enhance',
                sceneKey: 'web_content',
                userInfo,
                userInput,
              });

              const limit = concurrency.getChannelConcurrencyLimit(channel, resolvedRoute.kind);
              const response = await concurrency.runWithChannelConcurrency(routeKey(resolvedRoute), limit, () =>
                provider.chat([{ role: 'user', content: prompt }], { temperature: 0.2, maxTokens: 900 })
              );

              const responseText = response.choices?.[0]?.message?.content ?? '';
              const validated = validateWebEnhanceOutput(responseText);
              if (!validated.ok) {
                return runKeywordEnhance(options);
              }

              const base = validated.value;
              const rawConvert = Array.isArray(base.convert_word) ? base.convert_word : [];
              if (rawConvert.length === 0) {
                return { content_result: options.text, convert_word: [], highlight_terms: [], highlight_offsets: [] };
              }

              const originals = rawConvert.map((w) => w.original);
              const dictEntries = await dictionaryService.batchLookup(originals);
              const enriched = filterConvertWordByHits(
                options.text,
                rawConvert.map((word, idx) => {
                  const entry = dictEntries[idx];
                  const dictDifficulty = typeof entry?.difficulty === 'string' ? entry.difficulty.trim() : '';
                  const normalizedDifficulty = dictDifficulty.toUpperCase();
                  const difficultyLevel = (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).includes(
                    normalizedDifficulty as any
                  )
                    ? (normalizedDifficulty as CEFRLevel)
                    : undefined;
                  const partOfSpeech =
                    typeof entry?.definitions?.[0]?.partOfSpeech === 'string'
                      ? entry.definitions[0].partOfSpeech
                      : undefined;

                  const difficulty =
                    typeof word.difficulty === 'string' && word.difficulty.trim() ? word.difficulty.trim() : dictDifficulty;

                  return {
                    original: word.original,
                    converted: word.converted,
                    ...(difficulty ? { difficulty } : {}),
                    ...(difficultyLevel ? { difficultyLevel } : {}),
                    ...(typeof entry?.difficulty === 'string'
                      ? { difficultyConfidence: difficultyLevel ? 0.9 : 0.4 }
                      : { difficultyConfidence: 0.2 }),
                    ...(partOfSpeech ? { partOfSpeech } : {}),
                  };
                })
              );

              const convert_word = enriched.slice(0, Math.max(0, options.maxWords));
              const highlight_terms = convert_word.map((entry) => entry.original);
              const highlight_offsets = buildHighlightOffsets(options.text, highlight_terms);
              return { content_result: options.text, convert_word, highlight_terms, highlight_offsets };
            } catch (error: unknown) {
              log.debug('ENHANCE_WEB prompt enhance failed; falling back to keyword enhance', { message: getErrorMessage(error) });
              return runKeywordEnhance(options);
            }
          };

          if (mode !== 'full') {
            const enhanced =
              algorithm === 'prompt'
                ? await runPromptEnhance({ text: content, sourceLang, targetLang, maxWords })
                : await runKeywordEnhance({ text: content, sourceLang, targetLang, maxWords });
            return { value: enhanced, ok: (enhanced.convert_word?.length ?? 0) > 0 };
          }

          const isLearningLanguageContent = sourceLang === settings.targetLanguage;
          const canRewriteToLearningLanguage = !isLearningLanguageContent && settings.targetLanguage === 'en' && targetLang === 'en';

          if (!canRewriteToLearningLanguage) {
            const enhanced = await runKeywordEnhance({ text: content, sourceLang, targetLang, maxWords });
            return { value: enhanced, ok: enhanced.convert_word.length > 0 };
          }

          const rewritten = await translateText({ text: content, sourceLang, targetLang: 'en' });
          if (!rewritten.trim()) {
            const enhanced = await runKeywordEnhance({ text: content, sourceLang, targetLang, maxWords });
            return { value: enhanced, ok: false };
          }

          const guard = validateFullRewriteGuard({ original: content, rewritten });
          if (!guard.ok) {
            log.debug('ENHANCE_WEB full guard failed; falling back to keyword enhance', { reason: guard.reason });
            const fallbackEnhanced = await runKeywordEnhance({ text: content, sourceLang, targetLang, maxWords });
            return { value: fallbackEnhanced, ok: false };
          }

          const enhanced = await runKeywordEnhance({
            text: rewritten,
            sourceLang: 'en',
            targetLang: settings.nativeLanguage,
            maxWords,
          });

          const offsets = buildHighlightOffsets(rewritten, enhanced.highlight_terms ?? []);
          if ((enhanced.convert_word?.length ?? 0) > 0 && offsets.length === 0) {
            log.debug('ENHANCE_WEB full highlight usability guard failed; falling back to keyword enhance', {
              terms: enhanced.highlight_terms?.length ?? 0,
            });
            const fallbackEnhanced = await runKeywordEnhance({ text: content, sourceLang, targetLang, maxWords });
            return { value: fallbackEnhanced, ok: false };
          }

          return {
            value: {
              content_result: rewritten,
              convert_word: enhanced.convert_word,
              highlight_terms: enhanced.highlight_terms,
              highlight_offsets: offsets,
            },
            ok: enhanced.convert_word.length > 0,
          };
        } catch (error: unknown) {
          log.warn('ENHANCE_WEB failed; returning fallback output', { message: getErrorMessage(error) });
          return { value: { content_result: content, convert_word: [], highlight_terms: [], highlight_offsets: [] }, ok: false };
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

    const translateKeywordsRoute = resolveRoute('translate_keywords', settings);
    const nativeLang = payload.targetLang ?? settings.nativeLanguage;
    const needsAdapt = sourceLang !== settings.targetLanguage;

    const adaptRoute = needsAdapt ? resolveChannelRoute('adapt_subtitle', settings) : null;
    const adaptChannel = adaptRoute ? resolveChannel(adaptRoute.channelId, settings) : null;
    const adaptProviderInfo = adaptChannel ? getChatProviderByChannel(adaptChannel) : null;

    const cacheKey = makeCacheKey('ENHANCE_SUBTITLE', {
      v: 5,
      providers: {
        ...(needsAdapt && adaptRoute
          ? { adapt: routeIdentity(adaptRoute, settings) }
          : { translation: routeIdentity(translateKeywordsRoute, settings) }),
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
              const rawLines = subtitle.replace(/\r/g, '').split('\n');
              const sourceLines = rawLines.map((line) => line.trim()).filter(Boolean);
              if (sourceLines.length === 0) return '';

              const mapping = await translateKeywords({
                settings,
                keywords: sourceLines,
                ...(payload.contextBefore ? { contextBefore: payload.contextBefore } : {}),
                ...(payload.contextAfter ? { contextAfter: payload.contextAfter } : {}),
                sourceLang: String(sourceLang),
                targetLang: String(nativeLang),
                concurrency,
                log,
              });

              const translatedLines = sourceLines.map((line) => {
                const valueRaw = mapping[line];
                const value = typeof valueRaw === 'string' ? valueRaw.trim() : '';

                // Avoid duplicating the original subtitle text on translation failure.
                // Missing/empty translations keep the UI in an i18n loading state.
                if (!value) return '';
                if (value.toLowerCase() === line.toLowerCase()) return '';
                return value;
              });

              return translatedLines.join('\n');
            })();

            return {
              value: { line1_final: subtitle, ...(translated && translated.trim() ? { line2_final: translated.trim() } : {}) },
              ok: Boolean(translated && translated.trim()),
            };
          }

          if (!adaptChannel || !adaptProviderInfo || !adaptRoute) {
            return { value: { line1_final: subtitle }, ok: false };
          }

          const provider = getChatProvider(adaptProviderInfo.type, adaptProviderInfo.config);

          const motherTongue = settings.nativeLanguage;
          const targetLearningLanguage = settings.targetLanguage;

          const referenceLine = buildProficiencyReferenceLine({
            sourceLang: targetLearningLanguage,
            targetLang: motherTongue,
            userLevel: difficultyLevel,
            ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
          });

          const userInfo = makePromptUserInfo({
            motherTongue,
            targetLearningLanguage,
            cefrLevel: difficultyLevel,
            ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
          });

          const userInput = subtitle;

          const prompt = buildPrompt({
            agentKey: 'subtitle_adapt',
            sceneKey: 'video_subtitle',
            userInfo,
            userInput,
          });

          const adaptLimit = concurrency.getChannelConcurrencyLimit(adaptChannel, adaptRoute.kind);
          const response = await concurrency.runWithChannelConcurrency(routeKey(adaptRoute), adaptLimit, () =>
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
        } catch (error: unknown) {
          log.warn('ENHANCE_SUBTITLE failed; returning fallback output', { message: getErrorMessage(error) });
          const fallbackResult = validateSubtitleEnhanceOutput(undefined);
          const value = fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
          return { value, ok: false };
        }
      },
    });
  });

  registry.register('ENGLISH_CORRECTION', async (payload: EnglishCorrectionPayload) => {
    const text = payload.text.trim();
    if (!text) {
      throw new MessageError({ code: 'INVALID_PAYLOAD', message: 'Expected payload { text: string }' });
    }

    englishCorrectionStats.requestsTotal += 1;

    const settings = await getSettings();
    const userLevel = settings.proficiencyLevel;

    const route = resolveChannelRoute('english_correction', settings);
    const channel = resolveChannel(route.channelId, settings);
    if (!channel) {
      throw new MessageError({ code: 'PROVIDER_NOT_CONFIGURED', message: t('error_providerNotConfigured') });
    }

    const providerInfo = getChatProviderByChannel(channel);
    if (!providerInfo) {
      throw new MessageError({ code: 'PROVIDER_NOT_CONFIGURED', message: t('error_providerNotConfigured') });
    }

    const provider = getChatProvider(providerInfo.type, providerInfo.config);

    const cacheKey = makeCacheKey('ENGLISH_CORRECTION', {
      v: 1,
      provider: routeIdentity(route, settings),
      motherTongue: settings.nativeLanguage,
      targetLearningLanguage: settings.targetLanguage,
      userLevel,
      proficiencyPreference: settings.proficiencyPreference ?? null,
      text,
    });

    const apiEvent = englishCorrectionCache.get(cacheKey) === undefined && !englishCorrectionInFlight.has(cacheKey);
    const result = await getOrRunCachedTask(englishCorrectionCache, englishCorrectionInFlight, cacheKey, {
      ttlSuccessMs: CACHE_SUCCESS_TTL_MS,
      ttlFallbackMs: CACHE_FALLBACK_TTL_MS,
      run: async () => {
        try {
          const referenceLine = buildProficiencyReferenceLine({
            sourceLang: settings.targetLanguage,
            targetLang: settings.nativeLanguage,
            userLevel: settings.proficiencyLevel,
            ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
          });

          const userInfo = makePromptUserInfo({
            motherTongue: settings.nativeLanguage,
            targetLearningLanguage: settings.targetLanguage,
            cefrLevel: settings.proficiencyLevel,
            ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
          });

          const prompt = buildPrompt({
            agentKey: 'english_correction',
            sceneKey: 'english_correction',
            styleKey: pickStyleKey(undefined, settings.promptStyle),
            userInfo,
            userInput: text,
          });

          const limit = concurrency.getChannelConcurrencyLimit(channel, route.kind);
          const response = await concurrency.runWithChannelConcurrency(routeKey(route), limit, () =>
            provider.chat([{ role: 'user', content: prompt }], { temperature: 0.1, maxTokens: 180 })
          );

          const responseText = response.choices?.[0]?.message?.content ?? '';
          const validated = validateEnglishCorrectionOutputDetailed(responseText);
          if (validated.ok) {
            englishCorrectionStats.validatedOk += 1;
          } else {
            englishCorrectionStats.validatedFallback += 1;
            englishCorrectionStats.fallbackReasons[validated.reason] =
              (englishCorrectionStats.fallbackReasons[validated.reason] ?? 0) + 1;
          }

          const value = validated.ok ? validated.value : validated.fallback;
          if (value.hasError) {
            englishCorrectionStats.hasErrorTrue += 1;
          } else {
            englishCorrectionStats.hasErrorFalse += 1;
          }

          return { value, ok: validated.ok };
        } catch (error: unknown) {
          log.warn('ENGLISH_CORRECTION provider call failed; returning fallback output', { message: getErrorMessage(error) });
          englishCorrectionStats.providerFailures += 1;
          const validated = validateEnglishCorrectionOutput(undefined);
          return { value: validated.ok ? validated.value : validated.fallback, ok: false };
        }
      },
    });

    void bumpDailyUsage({ task: 'english_correction', provider: providerInfo.type, apiEvent, words: 0 });
    return result;
  });

  registry.register('EXPLAIN_WORD', async (payload: ExplainWordPayload) => {
    const word = payload.word.trim();
    const context = payload.context?.trim();
    if (!word) {
      throw new MessageError({ code: 'INVALID_PAYLOAD', message: 'Expected payload { word: string }' });
    }

    await recordLookupManual(word);

    const settings = await getSettings();
    const sourceLang = settings.targetLanguage;
    const targetLang = settings.nativeLanguage;
    const userLevel = settings.proficiencyLevel;

    const dictionaryRoute = resolveRoute('dictionary', settings);
    const dictionaryChannel = dictionaryRoute.kind === 1 ? resolveChannel(dictionaryRoute.channelId, settings) : null;
    const dictionaryProviderInfo = dictionaryChannel ? getChatProviderByChannel(dictionaryChannel) : null;

    const cacheKey = makeCacheKey('EXPLAIN_WORD', {
      v: 5,
      provider: routeIdentity(dictionaryRoute, settings),
      word,
      sourceLang,
      targetLang,
      userLevel,
      proficiencyPreference: settings.proficiencyPreference ?? null,
      context: context ?? '',
      contextBefore: (payload.contextBefore ?? []).join('\n'),
      contextAfter: (payload.contextAfter ?? []).join('\n'),
    });

    const cached = explainWordCache.get(cacheKey);
    if (cached) {
      void bumpDailyUsage({ task: 'explain_word', words: 1, apiEvent: false });
      return cached;
    }

    let providerKey: string | undefined;
    let apiEvent = !explainWordInFlight.has(cacheKey);

    const value = await dedupeInFlight(explainWordInFlight, cacheKey, async () => {
      const entry = await dictionaryService.lookup(word);
      if (entry) {
        providerKey = 'offline';
        apiEvent = false;
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

      if (dictionaryRoute.kind === 2 || dictionaryRoute.kind === 3) {
        try {
          providerKey = dictionaryRoute.kind === 2 ? 'google' : 'bing';
          apiEvent = true;
          const limit = concurrency.getChannelConcurrencyLimit(null, dictionaryRoute.kind);
          const translated = await concurrency.runWithChannelConcurrency(routeKey(dictionaryRoute), limit, () =>
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
        } catch (error: unknown) {
          log.warn('EXPLAIN_WORD translation fallback failed; returning unavailable definition', { message: getErrorMessage(error) });
          const value: ExplainWordOutput = { word, definition: t('wordCard_definitionUnavailable') };
          explainWordCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
          return value;
        }
      }

      if (!dictionaryProviderInfo || !dictionaryChannel) {
        providerKey = undefined;
        apiEvent = false;
        const value: ExplainWordOutput = { word, definition: t('wordCard_definitionUnavailable') };
        explainWordCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
        return value;
      }

      try {
        providerKey = dictionaryProviderInfo.type;
        apiEvent = true;
        const provider = getChatProvider(dictionaryProviderInfo.type, dictionaryProviderInfo.config);

        const parsedSourceLang = SupportedLanguageSchema.safeParse(sourceLang);
        const parsedTargetLang = NativeLanguageSchema.safeParse(targetLang);
        if (!parsedSourceLang.success || !parsedTargetLang.success) {
          throw new Error('Invalid sourceLang/targetLang for explain-word prompt');
        }

        const referenceLine = buildProficiencyReferenceLine({
          sourceLang: parsedSourceLang.data,
          targetLang: parsedTargetLang.data,
          userLevel,
          ...(settings.proficiencyPreference ? { proficiencyPreference: settings.proficiencyPreference } : {}),
        });

        const userInfo = makePromptUserInfo({
          motherTongue: parsedTargetLang.data,
          targetLearningLanguage: parsedSourceLang.data,
          cefrLevel: userLevel,
          ...(referenceLine ? { levelReferenceLine: referenceLine } : {}),
        });

        const userInput = word;

        const prompt = buildPrompt({
          agentKey: 'explain_word',
          sceneKey: 'word_card',
          userInfo,
          ...(context
            ? { contextInfo: makeContextInfoFromText(context) }
            : ((payload.contextBefore?.length ?? 0) > 0 || (payload.contextAfter?.length ?? 0) > 0
                ? { contextInfo: { before: payload.contextBefore ?? [], after: payload.contextAfter ?? [] } }
                : {})),
          userInput,
        });

        const limit = concurrency.getChannelConcurrencyLimit(dictionaryChannel, dictionaryRoute.kind);
        const response = await concurrency.runWithChannelConcurrency(routeKey(dictionaryRoute), limit, () =>
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

        try {
          await dictionaryService.upsert({
            word,
            ...(value.phonetic ? { phonetic: value.phonetic } : {}),
            definitions: [{ partOfSpeech: 'AI', definition: value.definition }],
            ...(value.difficulty ? { difficulty: value.difficulty } : {}),
          });
        } catch (error: unknown) {
          log.warn('Explain-word dictionary cache upsert failed; continuing without persistence', {
            word,
            error,
          });
        }

        explainWordCache.set(cacheKey, value, CACHE_SUCCESS_TTL_MS);
        return value;
      } catch (error: unknown) {
        log.warn('EXPLAIN_WORD failed; returning fallback definition', { word, message: getErrorMessage(error) });
        const value: ExplainWordOutput = { word, definition: t('wordCard_definitionFailed') };
        explainWordCache.set(cacheKey, value, CACHE_FALLBACK_TTL_MS);
        return value;
      }
    });

    void bumpDailyUsage({
      task: 'explain_word',
      ...(providerKey ? { provider: providerKey } : {}),
      words: 1,
      apiEvent,
    });

    return value;
  });
}

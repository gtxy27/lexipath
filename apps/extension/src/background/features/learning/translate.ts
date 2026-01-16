import type { Settings } from '@lexipath/core';

import { NativeLanguageSchema, SupportedLanguageSchema } from '@lexipath/core';

import { buildPrompt, buildProficiencyReferenceLine, parseTermTranslateResponse, parseTranslateKeywordsResponse } from '@lexipath/core/prompting';

import type { createConcurrencyManager } from '../../lib/concurrency';
import { bingTranslateProvider, getChatProvider, googleTranslateProvider } from '../../lib/providers';
import { getChatProviderByChannel, resolveChannel, resolveRoute, routeIdentity, routeKey } from '../../lib/routing';
import { makeContextInfoFromText, makePromptUserInfo } from '../../lib/prompt';
import { getOrRunCachedTask, makeCacheKey } from '../../pipeline';

import {
  CACHE_FALLBACK_TTL_MS,
  CACHE_SUCCESS_TTL_MS,
  translateKeywordsCache,
  translateKeywordsInFlight,
} from './cache';

type ConcurrencyManager = ReturnType<typeof createConcurrencyManager>;

type Logger = {
  warn: (...args: unknown[]) => void;
};

export async function translateTerms(options: {
  settings: Settings;
  terms: string[];
  sourceLang: string;
  targetLang: string;
  concurrency: Pick<ConcurrencyManager, 'getChannelConcurrencyLimit' | 'runWithChannelConcurrency'>;
  log: Logger;
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

export async function translateKeywords(options: {
  settings: Settings;
  keywords: string[];
  context?: string;
  contextBefore?: string[];
  contextAfter?: string[];
  sourceLang: string;
  targetLang: string;
  concurrency: Pick<ConcurrencyManager, 'getChannelConcurrencyLimit' | 'runWithChannelConcurrency'>;
  log: Logger;
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

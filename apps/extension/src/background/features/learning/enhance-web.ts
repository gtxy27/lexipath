import type { CEFRLevel, EnhanceWebPayload, Settings, WebEnhanceOutput } from '@lexipath/core';

import { buildHighlightOffsets } from '@lexipath/core';
import { getErrorMessage } from '@lexipath/core/log';
import { buildPrompt, buildProficiencyRangeReferenceLine } from '@lexipath/core/prompting';
import { validateWebEnhanceOutput } from '@lexipath/core/validators';

import { getSettings } from '../../../shared/storage';

import { bingTranslateProvider, getChatProvider, googleTranslateProvider } from '../../lib/providers';
import {
  getChatProviderByChannel,
  resolveChannel,
  resolveChannelRoute,
  resolveRoute,
  routeIdentity,
  routeKey,
} from '../../lib/routing';
import { makePromptUserInfo, nextCefrLevel } from '../../lib/prompt';
import { dictionaryService } from '../../services/dictionary';
import { getOrRunCachedTask, makeCacheKey } from '../../pipeline';

import type { LearningConcurrency, Logger, TranslatorLike } from './types';
import { webEnhanceCache, webEnhanceInFlight, CACHE_FALLBACK_TTL_MS, CACHE_SUCCESS_TTL_MS } from './cache';
import { getKeywordsForText } from './keyword-select';
import { translateTerms } from './translate';
import { validateFullRewriteGuard } from './guard';

export async function handleEnhanceWeb(options: {
  payload: EnhanceWebPayload;
  t: TranslatorLike;
  log: Logger;
  concurrency: LearningConcurrency;
}): Promise<WebEnhanceOutput> {
  const { payload, t, log, concurrency } = options;

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
        const translateText = async (opts: {
          text: string;
          sourceLang: EnhanceWebPayload['sourceLang'];
          targetLang: EnhanceWebPayload['targetLang'];
        }): Promise<string> => {
          const text = opts.text.trim();
          if (!text) return '';

          if (translateRoute.kind === 2) {
            const limit = concurrency.getChannelConcurrencyLimit(null, translateRoute.kind);
            return concurrency.runWithChannelConcurrency(routeKey(translateRoute), limit, () =>
              googleTranslateProvider.translate(text, {
                from: String(opts.sourceLang ?? settings.targetLanguage),
                to: String(opts.targetLang ?? settings.nativeLanguage),
              })
            );
          }

          if (translateRoute.kind === 3) {
            const limit = concurrency.getChannelConcurrencyLimit(null, translateRoute.kind);
            return concurrency.runWithChannelConcurrency(routeKey(translateRoute), limit, () =>
              bingTranslateProvider.translate(text, {
                from: String(opts.sourceLang ?? settings.targetLanguage),
                to: String(opts.targetLang ?? settings.nativeLanguage),
              })
            );
          }

          const [translated] = await translateTerms({
            settings,
            terms: [text],
            sourceLang: String(opts.sourceLang ?? settings.targetLanguage),
            targetLang: String(opts.targetLang ?? settings.nativeLanguage),
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

        const runKeywordEnhance = async (opts: {
          text: string;
          sourceLang: EnhanceWebPayload['sourceLang'];
          targetLang: EnhanceWebPayload['targetLang'];
          maxWords: number;
        }) => {
          const keywords = await getKeywordsForText({
            settings,
            text: opts.text,
            sourceLang: opts.sourceLang,
            targetLang: opts.targetLang,
            userLevel,
            scene: 'web',
            maxItems: opts.maxWords,
            t,
            log,
            concurrency,
          });

          if (!keywords.length) {
            return {
              content_result: opts.text,
              convert_word: [],
              highlight_terms: [] as string[],
              highlight_offsets: [] as Array<{ start: number; end: number; term: string }>,
            };
          }

          const translations = await translateTerms({
            settings,
            terms: keywords,
            sourceLang: String(opts.sourceLang ?? settings.targetLanguage),
            targetLang: String(opts.targetLang ?? settings.nativeLanguage),
            concurrency,
            log,
          });

           const dictEntries = await dictionaryService.batchLookup(keywords, sourceLang, sourceLang);

          const convert_word = filterConvertWordByHits(
            opts.text,
            keywords.map((original, idx) => {
              const converted = translations[idx] ?? original;
               const result = dictEntries[idx];
               const entry = result?.source;
               const difficulty = typeof entry?.difficulty === 'string' ? entry.difficulty.trim() : '';

              const normalizedDifficulty = difficulty.toUpperCase();
              const difficultyLevel = (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).includes(normalizedDifficulty as any)
                ? (normalizedDifficulty as CEFRLevel)
                : undefined;
               const partOfSpeech = typeof entry?.pos === 'string' ? entry.pos : undefined;


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
          const highlight_offsets = buildHighlightOffsets(opts.text, highlight_terms);
          return { content_result: opts.text, convert_word, highlight_terms, highlight_offsets };
        };

        const runPromptEnhance = async (opts: {
          text: string;
          sourceLang: EnhanceWebPayload['sourceLang'];
          targetLang: EnhanceWebPayload['targetLang'];
          maxWords: number;
        }) => {
          const resolvedRoute = translateRoute.kind === 1 ? translateRoute : keywordRoute;
          const channel = resolveChannel(resolvedRoute.channelId, settings);
          if (!channel) {
            return runKeywordEnhance(opts);
          }

          const providerInfo = getChatProviderByChannel(channel);
          if (!providerInfo) {
            return runKeywordEnhance(opts);
          }

          const provider = getChatProvider(providerInfo.type, providerInfo.config);
          const difficultyMin = userLevel;
          const difficultyMax = nextCefrLevel(userLevel);

          try {
            const resolvedSourceLang = String(opts.sourceLang ?? settings.targetLanguage) as any;
            const resolvedTargetLang = String(opts.targetLang ?? settings.nativeLanguage) as any;

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

            const prompt = buildPrompt({
              agentKey: 'web_enhance',
              sceneKey: 'web_content',
              userInfo,
              userInput: opts.text,
            });

            const limit = concurrency.getChannelConcurrencyLimit(channel, resolvedRoute.kind);
            const response = await concurrency.runWithChannelConcurrency(routeKey(resolvedRoute), limit, () =>
              provider.chat([{ role: 'user', content: prompt }], { temperature: 0.2, maxTokens: 900 })
            );

            const responseText = response.choices?.[0]?.message?.content ?? '';
            const validated = validateWebEnhanceOutput(responseText);
            if (!validated.ok) {
              return runKeywordEnhance(opts);
            }

            const base = validated.value;
            const rawConvert = Array.isArray(base.convert_word) ? base.convert_word : [];
            if (rawConvert.length === 0) {
              return { content_result: opts.text, convert_word: [], highlight_terms: [], highlight_offsets: [] };
            }

            const originals = rawConvert.map((w) => w.original);
             const dictEntries = await dictionaryService.batchLookup(originals, sourceLang, sourceLang);

            const enriched = filterConvertWordByHits(
              opts.text,
              rawConvert.map((word, idx) => {
                const result = dictEntries[idx];
                const entry = result?.source;
                const dictDifficulty = typeof entry?.difficulty === 'string' ? entry.difficulty.trim() : '';

                const normalizedDifficulty = dictDifficulty.toUpperCase();
                const difficultyLevel = (['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const).includes(normalizedDifficulty as any)
                  ? (normalizedDifficulty as CEFRLevel)
                  : undefined;
                const partOfSpeech = typeof entry?.pos === 'string' ? entry.pos : undefined;


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

            const convert_word = enriched.slice(0, Math.max(0, opts.maxWords));
            const highlight_terms = convert_word.map((entry) => entry.original);
            const highlight_offsets = buildHighlightOffsets(opts.text, highlight_terms);
            return { content_result: opts.text, convert_word, highlight_terms, highlight_offsets };
          } catch (error: unknown) {
            log.debug('ENHANCE_WEB prompt enhance failed; falling back to keyword enhance', { message: getErrorMessage(error) });
            return runKeywordEnhance(opts);
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
        const canRewriteToLearningLanguage =
          !isLearningLanguageContent && settings.targetLanguage === 'en' && targetLang === 'en';

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
        return {
          value: { content_result: content, convert_word: [], highlight_terms: [], highlight_offsets: [] },
          ok: false,
        };
      }
    },
  });
}

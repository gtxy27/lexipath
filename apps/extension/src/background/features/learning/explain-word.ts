import type { ExplainWordOutput, ExplainWordPayload } from '@lexipath/core';

import { NativeLanguageSchema, SupportedLanguageSchema } from '@lexipath/core';
import { getErrorMessage } from '@lexipath/core/log';
import { buildPrompt, buildProficiencyReferenceLine, parseExplainWordResponse } from '@lexipath/core/prompting';

import { MessageError } from '../../../shared/messages';
import { recordLookupManual } from '../../../shared/familiarity';
import { getSettings } from '../../../shared/storage';

import { bingTranslateProvider, getChatProvider, googleTranslateProvider } from '../../lib/providers';
import { getChatProviderByChannel, resolveChannel, resolveRoute, routeIdentity, routeKey } from '../../lib/routing'; 
import { makeContextInfoFromText, makePromptUserInfo } from '../../lib/prompt'; 
import { dedupeInFlight, makeCacheKey } from '../../pipeline'; 
import { dictionaryService } from '../../services/dictionary'; 
import { bumpDailyUsage } from '../../usage-summary'; 
 
import type { LearningConcurrency, Logger, TranslatorLike } from './types'; 
import { CACHE_FALLBACK_TTL_MS, CACHE_SUCCESS_TTL_MS, explainWordCache, explainWordInFlight } from './cache'; 

function normalizeExplainTextForDisplay(value: string): string {
  // Some providers return strings that contain literal "\n" sequences rather than actual newlines.
  // Convert those into real newlines so UIs with `white-space: pre-*` render them as line breaks.
  return String(value ?? '')
    .replaceAll('\\r\\n', '\n')
    .replaceAll('\\n', '\n')
    .replaceAll('\\r', '\n');
}

function normalizeExplainOutput(out: ExplainWordOutput): ExplainWordOutput {
  return {
    ...out,
    word: normalizeExplainTextForDisplay(out.word),
    definition: normalizeExplainTextForDisplay(out.definition),
    ...(out.targets ? { targets: out.targets.map(normalizeExplainTextForDisplay).filter((s) => s.trim()) } : {}),
    ...(out.example ? { example: normalizeExplainTextForDisplay(out.example) } : {}),
    ...(out.example_translation
      ? { example_translation: normalizeExplainTextForDisplay(out.example_translation) }
      : {}),
  };

}

export async function handleExplainWord(options: {
  payload: ExplainWordPayload;
  t: TranslatorLike;
  log: Logger;
  concurrency: LearningConcurrency;
}): Promise<ExplainWordOutput> {
  const { payload, t, log, concurrency } = options;

  const word = payload.word.trim();
  const context = payload.context?.trim();
  if (!word) {
    throw new MessageError({ code: 'INVALID_PAYLOAD', message: 'Expected payload { word: string }' });
  }

  await recordLookupManual(word); 
 
  const settings = await getSettings(); 
  const sourceLang = payload.sourceLang ?? settings.targetLanguage; 
  const targetLang = payload.targetLang ?? settings.nativeLanguage; 

  // Offline dictionary is seeded for a small set of base languages (e.g. zh, not zh-CN).
  // Map native locales to the closest seeded dictionary language.
  const dictionaryTargetLang = (() => {
    const raw = String(targetLang);
    const lower = raw.toLowerCase();
    if (lower === 'zh' || lower.startsWith('zh-') || lower.startsWith('zh_')) return 'zh';
    if (lower === 'en' || lower.startsWith('en-') || lower.startsWith('en_')) return 'en';
    if (lower === 'ja' || lower.startsWith('ja-') || lower.startsWith('ja_')) return 'ja';
    if (lower === 'ko' || lower.startsWith('ko-') || lower.startsWith('ko_')) return 'ko';
    // Fall back to source language (may still miss offline mappings).
    return sourceLang;
  })();
  const userLevel = settings.proficiencyLevel; 

  const dictionaryRoute = resolveRoute('dictionary', settings); 
  const dictionaryChannel = dictionaryRoute.kind === 1 ? resolveChannel(dictionaryRoute.channelId, settings) : null; 
  const dictionaryProviderInfo = dictionaryChannel ? getChatProviderByChannel(dictionaryChannel) : null; 

  const cacheKey = makeCacheKey('EXPLAIN_WORD', {
    v: 6,
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
        const dictResult = await dictionaryService.lookup(word, sourceLang, dictionaryTargetLang);

       // Only short-circuit when we have usable offline/cache content.
       // If offline returns no targets/explain, allow online fallback to run.
       const hasUsableOffline = !!dictResult && ((dictResult.targets?.length ?? 0) > 0 || !!dictResult.explain);
       if (dictResult && hasUsableOffline) {

        providerKey = dictResult.meta.origin === 'offline' ? 'offline' : (dictResult.meta.provider ?? 'cache');
        apiEvent = false;

        const cachedExplain = dictResult.explain;
        const orderedTargets = (dictResult.targets ?? []).map((t) => t.word).filter((w) => typeof w === 'string' && w.trim());
        const fallbackTranslation = orderedTargets[0] ?? '';

        const definition =
          typeof cachedExplain?.definition === 'string'
            ? cachedExplain.definition
            : (fallbackTranslation.trim() ? fallbackTranslation : t('wordCard_definitionUnavailable'));

        const normalizedWord =
          typeof cachedExplain?.word === 'string' && cachedExplain.word.trim()
            ? cachedExplain.word.trim()
            : (typeof dictResult.source?.word === 'string' && dictResult.source.word.trim() ? dictResult.source.word.trim() : word);

        const out: ExplainWordOutput = {
          word: normalizedWord,
          definition: definition.trim() ? definition : t('wordCard_definitionUnavailable'),
          ...(typeof cachedExplain?.phonetic === 'string' && cachedExplain.phonetic.trim() ? { phonetic: cachedExplain.phonetic.trim() } : {}),
          ...(typeof cachedExplain?.difficulty === 'string' && cachedExplain.difficulty.trim() ? { difficulty: cachedExplain.difficulty.trim() } : {}),

          ...(typeof cachedExplain?.example === 'string' && cachedExplain.example.trim() ? { example: cachedExplain.example.trim() } : {}),
          ...(typeof cachedExplain?.example_translation === 'string' && cachedExplain.example_translation.trim()
            ? { example_translation: cachedExplain.example_translation.trim() }
            : {}),
          ...(orderedTargets.length ? { targets: orderedTargets } : {}),
          meta: {
            origin: dictResult.meta.origin === 'offline' ? 'offline' : 'cache',
            ...(dictResult.meta.provider ? { provider: dictResult.meta.provider } : {}),
          },
        };

        const normalizedOut = normalizeExplainOutput(out);
        explainWordCache.set(cacheKey, normalizedOut, CACHE_SUCCESS_TTL_MS);
        return normalizedOut;
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

        const translationText = typeof translated === 'string' ? translated : '';
        const definition = translationText.trim() ? translationText.trim() : t('wordCard_definitionUnavailable');
        const out: ExplainWordOutput = {
          word,
          definition,
          ...(translationText.trim() ? { targets: [translationText.trim()] } : {}),

          meta: {
            origin: 'online',
            ...(providerKey ? { provider: providerKey } : {}),
          },
        };
        const normalizedOut = normalizeExplainOutput(out);
        explainWordCache.set(
          cacheKey,
          normalizedOut,
          translationText.trim() ? CACHE_SUCCESS_TTL_MS : CACHE_FALLBACK_TTL_MS,
        );

        return normalizedOut;
      } catch (error: unknown) {
        log.warn('EXPLAIN_WORD translation fallback failed; returning unavailable definition', { message: getErrorMessage(error) });
        const out: ExplainWordOutput = { word, definition: t('wordCard_definitionUnavailable') };
        explainWordCache.set(cacheKey, out, CACHE_FALLBACK_TTL_MS);
        return out;
      }
    }

    if (!dictionaryProviderInfo || !dictionaryChannel) {
      providerKey = undefined;
      apiEvent = false;
      const out: ExplainWordOutput = { word, definition: t('wordCard_definitionUnavailable') };
      explainWordCache.set(cacheKey, out, CACHE_FALLBACK_TTL_MS);
      return out;
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

      const prompt = buildPrompt({
        agentKey: 'explain_word',
        sceneKey: 'word_card',
        userInfo,
        ...(context
          ? { contextInfo: makeContextInfoFromText(context) }
          : ((payload.contextBefore?.length ?? 0) > 0 || (payload.contextAfter?.length ?? 0) > 0
              ? { contextInfo: { before: payload.contextBefore ?? [], after: payload.contextAfter ?? [] } }
              : {})),
        userInput: word,
      });

      const limit = concurrency.getChannelConcurrencyLimit(dictionaryChannel, dictionaryRoute.kind);
      const response = await concurrency.runWithChannelConcurrency(routeKey(dictionaryRoute), limit, () =>
        provider.chat([{ role: 'user', content: prompt }], {
          temperature: 0.2,
          maxTokens: 350,
        })
      );

      const responseText = (() => {
        if (!response || typeof response !== 'object') return '';
        const r = response as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = r.choices?.[0]?.message?.content;
        return typeof content === 'string' ? content : '';
      })();


      const parsed = parseExplainWordResponse(responseText);

      const definition =
        typeof parsed.definition === 'string' && parsed.definition.trim() ? parsed.definition.trim() : t('wordCard_definitionUnavailable');

      const out: ExplainWordOutput = {
        word,
        definition,
        ...(parsed.translation && parsed.translation.trim() ? { targets: [parsed.translation.trim()] } : {}),

        ...(parsed.phonetic && parsed.phonetic.trim() ? { phonetic: parsed.phonetic.trim() } : {}),
        ...(parsed.difficulty && parsed.difficulty.trim() ? { difficulty: parsed.difficulty.trim() } : {}),
        ...(parsed.example && parsed.example.trim() ? { example: parsed.example.trim() } : {}),
        ...(parsed.example_translation && parsed.example_translation.trim()
          ? { example_translation: parsed.example_translation.trim() }
          : {}),
        meta: {
          origin: 'online',
          ...(providerKey ? { provider: providerKey } : {}),
        },
      };


      try {
        await dictionaryService.putLookupCache({
          word,
          fromLang: sourceLang,
          toLang: dictionaryTargetLang,
          toLocale: String(targetLang),

          explain: {
            word,
            definition: out.definition,
            ...(out.phonetic ? { phonetic: out.phonetic } : {}),
            ...(out.difficulty ? { difficulty: out.difficulty } : {}),

            ...(out.example ? { example: out.example } : {}),
            ...(out.example_translation ? { example_translation: out.example_translation } : {}),
          },
          provider: providerKey ?? 'unknown',
          ttlMs: 30 * 24 * 60 * 60 * 1000,
        });
      } catch (error: unknown) {
        log.warn('Explain-word dictionary cache persist failed; continuing without persistence', {
          word,
          error,
        });
      }


      const normalizedOut = normalizeExplainOutput(out);
      explainWordCache.set(cacheKey, normalizedOut, CACHE_SUCCESS_TTL_MS);
      return normalizedOut;
    } catch (error: unknown) {
      log.warn('EXPLAIN_WORD failed; returning fallback definition', { word, message: getErrorMessage(error) });
      const out: ExplainWordOutput = { word, definition: t('wordCard_definitionFailed') };
      explainWordCache.set(cacheKey, out, CACHE_FALLBACK_TTL_MS);
      return out;
    }
  });

  void bumpDailyUsage({
    task: 'explain_word',
    ...(providerKey ? { provider: providerKey } : {}),
    words: 1,
    apiEvent,
  });

  return value;
}

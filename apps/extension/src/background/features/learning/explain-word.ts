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
    ...(out.translation ? { translation: normalizeExplainTextForDisplay(out.translation) } : {}),
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
      const out: ExplainWordOutput = { 
        word: normalizedWord, 
        definition: definition.trim() ? definition : t('wordCard_definitionUnavailable'), 
        ...(entry.phonetic && entry.phonetic.trim() ? { phonetic: entry.phonetic.trim() } : {}), 
        ...(entry.difficulty && entry.difficulty.trim() ? { difficulty: entry.difficulty.trim() } : {}), 
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

        const definition = translated?.trim() ? translated.trim() : t('wordCard_definitionUnavailable');
        const out: ExplainWordOutput = {
          word,
          definition,
          ...(translated?.trim() ? { translation: translated.trim() } : {}),
        };
        const normalizedOut = normalizeExplainOutput(out);
        explainWordCache.set(
          cacheKey,
          normalizedOut,
          translated?.trim() ? CACHE_SUCCESS_TTL_MS : CACHE_FALLBACK_TTL_MS,
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

      const responseText = response.choices?.[0]?.message?.content ?? '';
      const parsed = parseExplainWordResponse(responseText);

      const definition =
        typeof parsed.definition === 'string' && parsed.definition.trim() ? parsed.definition.trim() : t('wordCard_definitionUnavailable');

      const out: ExplainWordOutput = {
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
          ...(out.phonetic ? { phonetic: out.phonetic } : {}),
          definitions: [{ partOfSpeech: 'AI', definition: out.definition }],
          ...(out.difficulty ? { difficulty: out.difficulty } : {}),
        });
      } catch (error: unknown) {
        log.warn('Explain-word dictionary cache upsert failed; continuing without persistence', {
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

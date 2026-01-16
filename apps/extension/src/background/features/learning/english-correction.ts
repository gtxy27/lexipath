import type { EnglishCorrectionOutput, EnglishCorrectionPayload, Settings } from '@lexipath/core';

import { getErrorMessage } from '@lexipath/core/log';
import { buildPrompt, buildProficiencyReferenceLine } from '@lexipath/core/prompting';
import { validateEnglishCorrectionOutput, validateEnglishCorrectionOutputDetailed } from '@lexipath/core/validators';

import { MessageError } from '../../../shared/messages';
import { getSettings } from '../../../shared/storage';

import { getChatProvider } from '../../lib/providers';
import { getChatProviderByChannel, resolveChannel, resolveChannelRoute, routeIdentity, routeKey } from '../../lib/routing';
import { makePromptUserInfo, pickStyleKey } from '../../lib/prompt';
import { getOrRunCachedTask, makeCacheKey } from '../../pipeline';
import { bumpDailyUsage } from '../../usage-summary';
import { bumpEnglishCorrectionOutcome } from '../../english-correction-outcome-summary';

import type { LearningConcurrency, Logger, TranslatorLike } from './types';
import { CACHE_FALLBACK_TTL_MS, CACHE_SUCCESS_TTL_MS, englishCorrectionCache, englishCorrectionInFlight } from './cache';

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

export async function handleEnglishCorrection(options: {
  payload: EnglishCorrectionPayload;
  t: TranslatorLike;
  log: Logger;
  concurrency: LearningConcurrency;
}): Promise<EnglishCorrectionOutput> {
  const { payload, t, log, concurrency } = options;

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
          englishCorrectionStats.fallbackReasons[validated.reason] = (englishCorrectionStats.fallbackReasons[validated.reason] ?? 0) + 1;
        }

        const out = validated.ok ? validated.value : validated.fallback;
        if (out.hasError) {
          englishCorrectionStats.hasErrorTrue += 1;
        } else {
          englishCorrectionStats.hasErrorFalse += 1;
        }

        return { value: out, ok: validated.ok };
      } catch (error: unknown) {
        log.warn('ENGLISH_CORRECTION provider call failed; returning fallback output', { message: getErrorMessage(error) });
        englishCorrectionStats.providerFailures += 1;
        const validated = validateEnglishCorrectionOutput(undefined);
        return { value: validated.ok ? validated.value : validated.fallback, ok: false };
      }
    },
  });

  void bumpDailyUsage({ task: 'english_correction', provider: providerInfo.type, apiEvent, words: 0 });
  void bumpEnglishCorrectionOutcome({ hasError: result.hasError });
  return result;
}

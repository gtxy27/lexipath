import type { EnhanceSubtitlePayload, Settings, SubtitleEnhanceOutput } from '@lexipath/core';

import { getErrorMessage } from '@lexipath/core/log';
import { buildPrompt, buildProficiencyReferenceLine } from '@lexipath/core/prompting';
import { validateSubtitleEnhanceOutput } from '@lexipath/core/validators';

import { getSettings } from '../../../shared/storage';

import { getChatProvider } from '../../lib/providers';
import {
  getChatProviderByChannel,
  resolveChannel,
  resolveChannelRoute,
  resolveRoute,
  routeIdentity,
  routeKey,
} from '../../lib/routing';
import { makePromptUserInfo } from '../../lib/prompt';
import { getOrRunCachedTask, makeCacheKey } from '../../pipeline';

import type { LearningConcurrency, Logger } from './types';
import { subtitleEnhanceCache, subtitleEnhanceInFlight, CACHE_FALLBACK_TTL_MS, CACHE_SUCCESS_TTL_MS } from './cache';
import { translateKeywords } from './translate';

export async function handleEnhanceSubtitle(options: {
  payload: EnhanceSubtitlePayload;
  log: Logger;
  concurrency: LearningConcurrency;
}): Promise<SubtitleEnhanceOutput> {
  const { payload, log, concurrency } = options;

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

        const prompt = buildPrompt({
          agentKey: 'subtitle_adapt',
          sceneKey: 'video_subtitle',
          userInfo,
          userInput: subtitle,
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
        const value = mode === 'bilingual' ? { ...baseValue, ...(subtitle.trim() ? { line2_final: subtitle } : {}) } : baseValue;
        return { value, ok: validated.ok };
      } catch (error: unknown) {
        log.warn('ENHANCE_SUBTITLE failed; returning fallback output', { message: getErrorMessage(error) });
        const fallbackResult = validateSubtitleEnhanceOutput(undefined);
        const value = fallbackResult.ok ? fallbackResult.value : fallbackResult.fallback;
        return { value, ok: false };
      }
    },
  });
}

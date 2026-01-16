import type { CEFRLevel, EnhanceWebPayload, Settings } from '@lexipath/core';

import { buildPrompt, buildProficiencyReferenceLine, parseKeywordSelectResponse } from '@lexipath/core/prompting';

import type { createConcurrencyManager } from '../../lib/concurrency';
import type { Translator } from '../../lib/i18n';
import { getChatProvider } from '../../lib/providers';
import {
  getChatProviderByChannel,
  resolveChannel,
  resolveChannelRoute,
  routeIdentity,
  routeKey,
} from '../../lib/routing';
import { makePromptUserInfo } from '../../lib/prompt';
import { getOrRunCachedTask, makeCacheKey } from '../../pipeline';
import { filterSelectedKeywords } from '../../keyword-filter';

import {
  CACHE_FALLBACK_TTL_MS,
  CACHE_SUCCESS_TTL_MS,
  keywordSelectCache,
  keywordSelectInFlight,
} from './cache';

type ConcurrencyManager = ReturnType<typeof createConcurrencyManager>;

type Logger = {
  warn: (...args: unknown[]) => void;
};

export async function getKeywordsForText(options: {
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
  log: Logger;
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

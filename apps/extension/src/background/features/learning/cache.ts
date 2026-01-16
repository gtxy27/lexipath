import type {
  EnglishCorrectionOutput,
  ExplainWordOutput,
  SubtitleEnhanceOutput,
  WebEnhanceOutput,
} from '@lexipath/core';

import { createExpiringLruCache } from '../../pipeline';

export const CACHE_MAX_ENTRIES = 200;
export const CACHE_SUCCESS_TTL_MS = 5 * 60 * 1000;
export const CACHE_FALLBACK_TTL_MS = 60 * 1000;

export const webEnhanceCache = createExpiringLruCache<WebEnhanceOutput>(CACHE_MAX_ENTRIES);
export const subtitleEnhanceCache = createExpiringLruCache<SubtitleEnhanceOutput>(CACHE_MAX_ENTRIES);
export const keywordSelectCache = createExpiringLruCache<string[]>(CACHE_MAX_ENTRIES);
export const translateKeywordsCache = createExpiringLruCache<Record<string, string>>(CACHE_MAX_ENTRIES);
export const explainWordCache = createExpiringLruCache<ExplainWordOutput>(CACHE_MAX_ENTRIES);
export const englishCorrectionCache = createExpiringLruCache<EnglishCorrectionOutput>(CACHE_MAX_ENTRIES);

export const webEnhanceInFlight = new Map<string, Promise<WebEnhanceOutput>>();
export const subtitleEnhanceInFlight = new Map<string, Promise<SubtitleEnhanceOutput>>();
export const keywordSelectInFlight = new Map<string, Promise<string[]>>();
export const translateKeywordsInFlight = new Map<string, Promise<Record<string, string>>>();
export const explainWordInFlight = new Map<string, Promise<ExplainWordOutput>>();
export const englishCorrectionInFlight = new Map<string, Promise<EnglishCorrectionOutput>>();

import type { EnhanceWebPayload, TranslateKeywordsPayload, EnhanceSubtitlePayload, EnglishCorrectionPayload, ExplainWordPayload } from '@lexipath/core';

import { getSettings } from '../../../shared/storage';

import type { Registry, Logger, TranslatorLike, LearningConcurrency } from './types';
import { getKeywordsForText } from './keyword-select';
import { translateKeywords } from './translate';
import { handleEnhanceWeb } from './enhance-web';
import { handleEnhanceSubtitle } from './enhance-subtitle';
import { handleEnglishCorrection } from './english-correction';
import { handleExplainWord } from './explain-word';

export function registerLearningFeature(options: {
  registry: Registry;
  t: TranslatorLike;
  log: Logger;
  concurrency: LearningConcurrency;
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
    return handleEnhanceWeb({ payload, t, log, concurrency });
  });

  registry.register('ENHANCE_SUBTITLE', async (payload: EnhanceSubtitlePayload) => {
    return handleEnhanceSubtitle({ payload, log, concurrency });
  });

  registry.register('ENGLISH_CORRECTION', async (payload: EnglishCorrectionPayload) => {
    return handleEnglishCorrection({ payload, t, log, concurrency });
  });

  registry.register('EXPLAIN_WORD', async (payload: ExplainWordPayload) => {
    return handleExplainWord({ payload, t, log, concurrency });
  });
}

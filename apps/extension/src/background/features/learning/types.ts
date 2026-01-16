import type { createMessageHandlerRegistry } from '../../../shared/messages';
import type { createConcurrencyManager } from '../../lib/concurrency';
import type { Translator } from '../../lib/i18n';

export type Registry = ReturnType<typeof createMessageHandlerRegistry>;
export type ConcurrencyManager = ReturnType<typeof createConcurrencyManager>;
export type LearningConcurrency = Pick<ConcurrencyManager, 'getChannelConcurrencyLimit' | 'runWithChannelConcurrency'>;

export type Logger = {
  warn: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

export type TranslatorLike = Translator;

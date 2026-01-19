/**
 * @lexipath/dictionary
 *
 * Offline-first dictionary with IndexedDB storage.
 * Provides word lookup, caching, and optional online fallback.
 */

export { DictionaryService } from './dictionary-service';
export type {
  DictionaryConfig,
  DictionaryLanguage,
  DictionaryWord,
  LookupExplain,
  LookupMeta,
  LookupQuery,
  LookupResult,
} from './types';


export { speak, stop, getVoices } from './tts-service';
export type { TtsSpeakOptions } from './tts-service';

/**
 * Prompt builders for LLM requests.
 *
 * All prompts follow these design principles from VocabMeld:
 * - Output structured JSON format
 * - Include CEFR difficulty levels (A1-C2)
 * - Clear rules and constraints
 * - Handle both plain JSON and markdown code blocks in responses
 */

export {
  buildWebEnhancePrompt,
  parseWebEnhanceResponse,
  type WebEnhancePromptOptions,
} from './web-enhance-prompt';

export {
  buildSubtitleEnhancePrompt,
  parseSubtitleEnhanceResponse,
  type SubtitleEnhancePromptOptions,
} from './subtitle-enhance-prompt';

export {
  buildSubtitleAdaptPrompt,
  type SubtitleAdaptPromptOptions,
} from './subtitle-adapt-prompt';

export {
  buildExplainWordPrompt,
  parseExplainWordResponse,
  type ExplainWordPromptOptions,
} from './explain-word-prompt';

export {
  buildKeywordSelectPrompt,
  parseKeywordSelectResponse,
  type KeywordSelectPromptOptions,
} from './keyword-select-prompt';

export {
  buildTermTranslatePrompt,
  parseTermTranslateResponse,
  type TermTranslatePromptOptions,
} from './term-translate-prompt';

export {
  buildTranslateKeywordsPrompt,
  parseTranslateKeywordsResponse,
  type TranslateKeywordsPromptOptions,
} from './translate-keywords-prompt';

export { renderPromptTemplate } from './prompt-template-renderer';

export {
  buildEnglishCorrectionPrompt,
  type EnglishCorrectionPromptOptions,
} from './english-correction-prompt';

/**
 * @lexipath/providers
 *
 * OpenAI-compatible provider adapter.
 * Handles API requests, error classification, and response parsing.
 */

export { OpenAICompatibleProvider } from './llm/openai-compatible';
export type {
  ChatCompletionMessage,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatWithThinkingResult,
} from './llm/openai-compatible';
export { ClaudeProvider } from './llm/claude';
export { GeminiProvider } from './llm/gemini';
export { GoogleTranslateProvider } from './translate/google-translate';
export { BingTranslateProvider } from './translate/bing-translate';
export * from './dictionary';
export { classifyError } from './errors';
export type { ProviderError, ProviderErrorCode } from './errors';

/**
 * @lexipath/providers
 *
 * OpenAI-compatible provider adapter.
 * Handles API requests, error classification, and response parsing.
 */

export { OpenAICompatibleProvider } from './openai-compatible';
export type { ChatMessage, ChatCompletionRequest, ChatCompletionResponse } from './openai-compatible';
export { ClaudeProvider } from './claude';
export { GeminiProvider } from './gemini';
export { GoogleTranslateProvider } from './google-translate';
export { BingTranslateProvider } from './bing-translate';
export { classifyError } from './errors';
export type { ProviderError, ProviderErrorCode } from './errors';

export * from './prompts';

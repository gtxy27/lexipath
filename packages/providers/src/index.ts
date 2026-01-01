/**
 * @lexipath/providers
 *
 * OpenAI-compatible provider adapter.
 * Handles API requests, error classification, and response parsing.
 */

export { OpenAICompatibleProvider } from './openai-compatible';
export type { ChatMessage, ChatCompletionRequest, ChatCompletionResponse } from './openai-compatible';
export { classifyError } from './errors';
export type { ProviderError, ProviderErrorCode } from './errors';

export * from './prompts';

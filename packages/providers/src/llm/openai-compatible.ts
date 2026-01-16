import type {
  LLMChatCompletionResponse,
  LLMChatMessage,
  LLMChatCompletionMessage,
  LLMChatOptions,
  LLMChatProvider,
  LLMChatWithThinkingResult,
  ProviderConfig,
  ThinkingMode,
} from '@lexipath/core';

import { makeCacheKey } from '@lexipath/core/cache-key';
import { createLogger, getErrorMessage } from '@lexipath/core/log';
import { classifyError, type ProviderError } from '../errors';
import { parseSseStream } from './sse';
import type { StreamChatOptions, StreamChatResult } from './stream';

export type ChatMessage = LLMChatMessage;
export type ChatOptions = LLMChatOptions;
export type ChatCompletionResponse = LLMChatCompletionResponse;
export type ChatWithThinkingResult = LLMChatWithThinkingResult;
export type ChatProvider = LLMChatProvider;


const log = createLogger('providers:openai-compatible');



export type ChatCompletionMessage = LLMChatCompletionMessage;




export interface ChatCompletionThinking {
  type: ThinkingMode;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  // Vendor extension (e.g. Volcano/Ark). Most OpenAI-compatible gateways ignore unknown fields.
  thinking?: ChatCompletionThinking;
}





// Public provider surface area. Other packages should depend on this interface,
// not on concrete provider classes.


interface InFlightRequest {
  promise: Promise<ChatCompletionResponse>;
  timestamp: number;
  controller: AbortController;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const DEFAULT_THINKING_MODE: ThinkingMode = 'disabled';



/**
 * OpenAI-compatible provider adapter.
 * Works with any API that follows the OpenAI chat completions format.
 *
 * Features:
 * - Automatic timeout handling (default 30s)
 * - Exponential backoff retry logic (max 3 attempts)
 * - Request deduplication by cache key
 */

export class OpenAICompatibleProvider implements ChatProvider {


  private config: ProviderConfig;
  private inFlightRequests = new Map<string, InFlightRequest>();
  private supportsThinkingControl: boolean | null = null;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  private resolveBaseUrl(): string {
    return this.config.baseUrl ?? DEFAULT_BASE_URL;
  }

  private resolveThinkingMode(options: ChatOptions): ThinkingMode {
    return options.thinking ?? DEFAULT_THINKING_MODE;
  }

  /**
   * Generate cache key for request deduplication.
   */
  private generateCacheKey(messages: ChatMessage[], options: {
    temperature?: number;
    maxTokens?: number;
    thinking?: ThinkingMode;
  }): string {
    const thinking = this.resolveThinkingMode(options);

    return makeCacheKey('openai-chat', {
      model: this.config.model ?? '',
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      thinking,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
    });
  }

  private createProviderError(status: number, errorText: string): Error {
    const error = new Error(`Provider error: ${status} - ${errorText}`);
    (error as any).status = status;
    (error as any).body = errorText;
    return error;
  }

  private supportsThinkingByDefault(): boolean {
    // Heuristic: official OpenAI endpoints are less likely to accept vendor fields.
    // Gateways commonly ignore unknown fields, so we try enabling by default there.
    try {
      const url = new URL(this.resolveBaseUrl());
      if (url.hostname === 'api.openai.com') return false;
    } catch (error: unknown) {
      log.debug('Could not parse baseUrl while checking thinking support; defaulting to enabled', { message: getErrorMessage(error) });
    }
    return true;
  }

  private shouldIncludeThinking(thinking: ThinkingMode): boolean {
    if (!this.supportsThinkingByDefault()) return false;
    if (this.supportsThinkingControl === false) return false;

    // Some OpenAI-compatible gateways default to "reasoning/thinking enabled" when the field is absent.
    // To keep latency predictable (and match older behavior where we effectively sent "disabled"),
    // we include the `thinking` field whenever we're on a gateway that might support it.
    void thinking;
    return true;
  }

  private isThinkingLikelyUnsupported(error: unknown): boolean {
    const body = typeof (error as any)?.body === 'string' ? (error as any).body : '';
    if (!body) return false;
    const normalized = body.toLowerCase();
    if (!normalized.includes('thinking')) return false;
    return (
      normalized.includes('unknown') ||
      normalized.includes('unexpected') ||
      normalized.includes('additional properties') ||
      normalized.includes('not allowed') ||
      normalized.includes('unrecognized')
    );
  }

  /**
   * Execute request with timeout.
   */
  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number,
    cancelSignal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const abortListener = () => controller.abort();

    if (cancelSignal) {
      if (cancelSignal.aborted) {
        controller.abort();
      } else {
        cancelSignal.addEventListener('abort', abortListener, { once: true });
      }
    }

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    } finally {
      if (cancelSignal) {
        cancelSignal.removeEventListener('abort', abortListener);
      }
    }
  }

  private extractThinkingFromMessage(message: unknown): string | undefined {
    if (!message || typeof message !== 'object') return undefined;

    const record = message as Record<string, unknown>;

    const directThinking = record.thinking;
    if (typeof directThinking === 'string' && directThinking.trim()) {
      return directThinking;
    }

    // Common vendor keys seen on OpenAI-compatible gateways.
    const candidates: Array<unknown> = [
      record.reasoning_content,
      record.reasoning,
      record.thinking_content,
      record.thought,
    ];

    for (const value of candidates) {
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }

    return undefined;
  }

  private normalizeThinkingInResponse(raw: unknown): ChatCompletionResponse {
    if (!raw || typeof raw !== 'object') {
      return raw as ChatCompletionResponse;
    }

    const record = raw as Record<string, unknown>;
    const choices = record.choices;
    if (!Array.isArray(choices)) {
      return raw as ChatCompletionResponse;
    }

    let changed = false;
    const normalizedChoices = choices.map((choice) => {
      if (!choice || typeof choice !== 'object') return choice;
      const choiceRecord = choice as Record<string, unknown>;
      const message = choiceRecord.message;
      const thinking = this.extractThinkingFromMessage(message);

      if (!thinking) return choice;
      if (!message || typeof message !== 'object') return choice;

      const messageRecord = message as Record<string, unknown>;
      const existingThinking = messageRecord.thinking;
      if (typeof existingThinking === 'string' && existingThinking.trim()) return choice;

      changed = true;
      return {
        ...choiceRecord,
        message: {
          ...messageRecord,
          thinking,
        },
      };
    });

    if (!changed) return raw as ChatCompletionResponse;
    return {
      ...(record as any),
      choices: normalizedChoices,
    } as ChatCompletionResponse;
  }

  /**
   * Execute request with exponential backoff retry.
   */
  private async executeWithRetry(
    messages: ChatMessage[],
    options: ChatOptions,
    cancelSignal: AbortSignal,
    maxRetries: number = DEFAULT_MAX_RETRIES
  ): Promise<ChatCompletionResponse> {
    const url = `${this.resolveBaseUrl().replace(/\/+$/, '')}/chat/completions`;
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const thinkingMode = this.resolveThinkingMode(options);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.customHeaders,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const baseBody: Omit<ChatCompletionRequest, 'thinking'> = {
      model: this.config.model,
      messages,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
    };

    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (cancelSignal.aborted) {
          throw Object.assign(new Error('Request was cancelled'), { name: 'AbortError' });
        }

        const includeThinking = this.shouldIncludeThinking(thinkingMode);
        const buildBody = (include: boolean): ChatCompletionRequest => ({
          ...baseBody,
          ...(include ? { thinking: { type: thinkingMode } } : {}),
        });

        const response = await this.fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(buildBody(includeThinking)),
          },
          timeoutMs,
          cancelSignal
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw this.createProviderError(response.status, errorText);
        }

        if (includeThinking && this.supportsThinkingControl === null) {
          this.supportsThinkingControl = true;
        }

        const json = await response.json();
        return this.normalizeThinkingInResponse(json);
      } catch (error) {
        const status = typeof (error as any)?.status === 'number' ? (error as any).status : null;

        // Compatibility fallback: if the gateway rejects vendor fields, retry once without them.
        if (
          attempt === 0 &&
          status === 400 &&
          this.supportsThinkingControl === null &&
          this.shouldIncludeThinking(thinkingMode) &&
          // Some gateways return unhelpful 400 bodies; don't require keyword matching.
          (this.isThinkingLikelyUnsupported(error) || thinkingMode === 'disabled')
        ) {
          try {
            const response = await this.fetchWithTimeout(
              url,
              {
                method: 'POST',
                headers,
                body: JSON.stringify(baseBody),
              },
              timeoutMs,
              cancelSignal
            );

            if (response.ok) {
              this.supportsThinkingControl = false;
              return await response.json();
            }
          } catch (fallbackError: unknown) {
            log.debug('Retry without thinking failed; proceeding with normal retry flow', { message: getErrorMessage(fallbackError) });
          }
        }

        lastError = error;
        const classified = classifyError(error);

        if (cancelSignal.aborted || !classified.retryable || attempt === maxRetries - 1) {
          throw error;
        }

        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }

  /**
   * Send a chat completion request with deduplication.
   */
  async chat(
    messages: ChatMessage[],
    options: ChatOptions = {}
  ): Promise<ChatCompletionResponse> {
    const cacheKey = this.generateCacheKey(messages, options);

    const existing = this.inFlightRequests.get(cacheKey);
    if (existing) {
      return existing.promise;
    }

    const controller = new AbortController();
    const promise = this.executeWithRetry(messages, options, controller.signal)
      .finally(() => {
        this.inFlightRequests.delete(cacheKey);
      });

    this.inFlightRequests.set(cacheKey, {
      promise,
      timestamp: Date.now(),
      controller,
    });

    return promise;
  }

  async chatWithThinking(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatWithThinkingResult> {
    const response = await this.chat(messages, options);
    const choice = response.choices?.[0];
    const message = choice?.message;
    const thinking = typeof message?.thinking === 'string' && message.thinking.trim() ? message.thinking : undefined;
    const finishReason = typeof choice?.finish_reason === 'string' && choice.finish_reason ? choice.finish_reason : undefined;

    return {
      response,
      content: message?.content ?? '',
      ...(thinking ? { thinking } : {}),
      ...(finishReason ? { finishReason } : {}),
    };
  }

  async streamChat(messages: ChatMessage[], options: StreamChatOptions): Promise<StreamChatResult> {
    const url = `${this.resolveBaseUrl().replace(/\/+$/, '')}/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.customHeaders,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const controller = new AbortController();
    const abortListener = () => controller.abort();
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (options.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', abortListener, { once: true });
      }
    }

    try {
      const body: ChatCompletionRequest = {
        model: this.config.model,
        messages,
        stream: true,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw this.createProviderError(response.status, errorText);
      }

      let content = '';
      let thinking = '';

      await parseSseStream(response, {
        signal: controller.signal,
        onData: (data) => {
          if (data === '[DONE]') return;

          try {
            const parsed = JSON.parse(data);
            const deltaRecord = parsed?.choices?.[0]?.delta;

            const thinkingDelta =
              deltaRecord?.reasoning_content ??
              deltaRecord?.reasoning ??
              deltaRecord?.thinking_content ??
              deltaRecord?.thinking ??
              deltaRecord?.thought ??
              parsed?.choices?.[0]?.message?.thinking ??
              parsed?.choices?.[0]?.message?.reasoning_content ??
              parsed?.choices?.[0]?.message?.reasoning ??
              '';

            if (typeof thinkingDelta === 'string' && thinkingDelta) {
              thinking += thinkingDelta;
              options.onThinkingDelta?.(thinkingDelta);
            }

            const delta =
              deltaRecord?.content ??
              deltaRecord?.text ??
              parsed?.choices?.[0]?.message?.content ??
              '';

            if (typeof delta === 'string' && delta) {
              content += delta;
              options.onDelta(delta);
            }
          } catch (error: unknown) {
            log.debug('OpenAI SSE chunk parse failed; ignoring chunk', { message: getErrorMessage(error) });
          }
        },
      });

      return {
        content,
        ...(thinking.trim() ? { thinking } : {}),
      };
    } finally {
      clearTimeout(timeoutId);
      if (options.signal) {
        options.signal.removeEventListener('abort', abortListener);
      }
    }
  }


  /**
   * Test connection to the provider.
   */
  async testConnection(): Promise<{ ok: true } | { ok: false; error: ProviderError }> {
    try {
      await this.chat([{ role: 'user', content: 'Hello' }], { maxTokens: 1, timeout: 10000 });
      return { ok: true };
    } catch (error) {
      const classified = classifyError(error);
      return {
        ok: false,
        error: classified,
      };
    }
  }

  /**
   * Cancel any in-flight request.
   */
  cancel(): void {
    for (const request of this.inFlightRequests.values()) {
      request.controller.abort();
    }
    this.inFlightRequests.clear();
  }
}

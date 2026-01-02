import type { ProviderConfig } from '@lexipath/core';
import { classifyError } from './errors';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ThinkingMode = 'disabled' | 'auto' | 'enabled';

export interface ChatCompletionThinking {
  type: ThinkingMode;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  // Vendor extension (e.g. Volcano/Ark). Most OpenAI-compatible gateways ignore unknown fields.
  thinking?: ChatCompletionThinking;
}

export interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    message: ChatMessage;
    finish_reason: string;
  }>;
}

interface InFlightRequest {
  promise: Promise<ChatCompletionResponse>;
  timestamp: number;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const DEFAULT_THINKING_MODE: ThinkingMode = 'disabled';

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
  thinking?: ThinkingMode;
}

/**
 * OpenAI-compatible provider adapter.
 * Works with any API that follows the OpenAI chat completions format.
 *
 * Features:
 * - Automatic timeout handling (default 30s)
 * - Exponential backoff retry logic (max 3 attempts)
 * - Request deduplication by cache key
 */
export class OpenAICompatibleProvider {
  private config: ProviderConfig;
  private abortController: AbortController | null = null;
  private inFlightRequests = new Map<string, InFlightRequest>();
  private supportsThinkingControl: boolean | null = null;

  constructor(config: ProviderConfig) {
    this.config = config;
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
    const key = {
      model: this.config.model,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      thinking,
    };
    return JSON.stringify(key);
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
      const url = new URL(this.config.baseUrl);
      if (url.hostname === 'api.openai.com') return false;
    } catch {
      // ignore
    }
    return true;
  }

  private shouldIncludeThinking(thinking: ThinkingMode): boolean {
    if (!this.supportsThinkingByDefault()) return false;
    if (this.supportsThinkingControl === false) return false;
    // Only include when the caller expresses an intent (we default to disabled).
    return Boolean(thinking);
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
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
    }
  }

  /**
   * Execute request with exponential backoff retry.
   */
  private async executeWithRetry(
    messages: ChatMessage[],
    options: ChatOptions,
    maxRetries: number = DEFAULT_MAX_RETRIES
  ): Promise<ChatCompletionResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;
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
          timeoutMs
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw this.createProviderError(response.status, errorText);
        }

        if (includeThinking && this.supportsThinkingControl === null) {
          this.supportsThinkingControl = true;
        }

        return await response.json();
      } catch (error) {
        const status = typeof (error as any)?.status === 'number' ? (error as any).status : null;

        // Compatibility fallback: if the gateway rejects vendor fields, retry once without them.
        if (
          attempt === 0 &&
          status === 400 &&
          this.supportsThinkingControl === null &&
          this.shouldIncludeThinking(thinkingMode) &&
          this.isThinkingLikelyUnsupported(error)
        ) {
          try {
            const response = await this.fetchWithTimeout(
              url,
              {
                method: 'POST',
                headers,
                body: JSON.stringify(baseBody),
              },
              timeoutMs
            );

            if (response.ok) {
              this.supportsThinkingControl = false;
              return await response.json();
            }
          } catch {
            // ignore and proceed with normal retry flow
          }
        }

        lastError = error;
        const classified = classifyError(error);

        if (!classified.retryable || attempt === maxRetries - 1) {
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

    const promise = this.executeWithRetry(messages, options)
      .finally(() => {
        this.inFlightRequests.delete(cacheKey);
      });

    this.inFlightRequests.set(cacheKey, {
      promise,
      timestamp: Date.now(),
    });

    return promise;
  }

  /**
   * Test connection to the provider.
   */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.chat([{ role: 'user', content: 'Hello' }], { maxTokens: 1, timeout: 10000 });
      return { ok: true };
    } catch (error) {
      const classified = classifyError(error);
      return {
        ok: false,
        error: classified.message,
      };
    }
  }

  /**
   * Cancel any in-flight request.
   */
  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.inFlightRequests.clear();
  }
}

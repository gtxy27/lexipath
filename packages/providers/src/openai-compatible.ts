import type { ProviderConfig } from '@lexipath/core';
import { classifyError } from './errors';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
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

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Generate cache key for request deduplication.
   */
  private generateCacheKey(messages: ChatMessage[], options: {
    temperature?: number;
    maxTokens?: number;
  }): string {
    const key = {
      model: this.config.model,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    };
    return JSON.stringify(key);
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
    options: { temperature?: number; maxTokens?: number; timeout?: number },
    maxRetries: number = DEFAULT_MAX_RETRIES
  ): Promise<ChatCompletionResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.customHeaders,
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    const body: ChatCompletionRequest = {
      model: this.config.model,
      messages,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { max_tokens: options.maxTokens }),
    };

    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          },
          timeoutMs
        );

        if (!response.ok) {
          const errorText = await response.text();
          const error = new Error(`Provider error: ${response.status} - ${errorText}`);
          (error as any).status = response.status;
          throw error;
        }

        return await response.json();
      } catch (error) {
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
    options: { temperature?: number; maxTokens?: number; timeout?: number } = {}
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

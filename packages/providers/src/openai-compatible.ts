import type { ProviderConfig } from '@lexipath/core';

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

/**
 * OpenAI-compatible provider adapter.
 * Works with any API that follows the OpenAI chat completions format.
 */
export class OpenAICompatibleProvider {
  private config: ProviderConfig;
  private abortController: AbortController | null = null;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Send a chat completion request.
   */
  async chat(
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number; signal?: AbortSignal } = {}
  ): Promise<ChatCompletionResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;

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
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Provider error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Test connection to the provider.
   */
  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.chat([{ role: 'user', content: 'Hello' }], { maxTokens: 1 });
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Cancel any in-flight request.
   */
  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }
}

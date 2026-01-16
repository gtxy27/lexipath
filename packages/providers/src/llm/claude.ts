import type { ClaudeProviderConfig } from '@lexipath/core';
import { makeCacheKey } from '@lexipath/core/cache-key';
import { classifyError, type ProviderError } from '../errors';
import type { ChatCompletionResponse, ChatMessage, ChatOptions, ChatWithThinkingResult, ChatProvider } from './openai-compatible';
import { parseSseStream } from './sse';
import type { StreamChatOptions, StreamChatResult } from './stream';


interface InFlightRequest {
  promise: Promise<ChatCompletionResponse>;
  timestamp: number;
  controller: AbortController;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const DEFAULT_MAX_TOKENS = 1000;
const ANTHROPIC_VERSION = '2023-06-01';

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function extractSystemPrompt(messages: ChatMessage[]): { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const systemParts: string[] = [];
  const filtered: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) systemParts.push(message.content.trim());
      continue;
    }
    if (message.role === 'user' || message.role === 'assistant') {
      filtered.push({ role: message.role, content: message.content });
    }
  }

  const system = systemParts.length ? systemParts.join('\n\n') : undefined;
  return { ...(system ? { system } : {}), messages: filtered };
}

function toChatCompletionResponse(input: unknown): ChatCompletionResponse {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid response from Claude (expected object)');
  }

  const record = input as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : 'claude';
  const stopReason = typeof record.stop_reason === 'string' ? record.stop_reason : 'stop';
  const content = record.content;

  let text = '';
  let thinking = '';
  if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      const partRecord = part as Record<string, unknown>;
      if (partRecord.type === 'text') {
        const chunk = typeof partRecord.text === 'string' ? partRecord.text : '';
        if (chunk) text += chunk;
        continue;
      }

      // Anthropic "thinking" blocks (when enabled) are separate from the user-facing answer.
      if (partRecord.type === 'thinking') {
        const chunk =
          typeof (partRecord as any).thinking === 'string'
            ? String((partRecord as any).thinking)
            : typeof (partRecord as any).text === 'string'
              ? String((partRecord as any).text)
              : '';
        if (chunk) thinking += chunk;
      }
    }
  } else if (typeof content === 'string') {
    text = content;
  }

  return {
    id,
    choices: [
      {
        message: { role: 'assistant', content: text, ...(thinking.trim() ? { thinking } : {}) },
        finish_reason: stopReason,
      },
    ],
  };
}

export class ClaudeProvider implements ChatProvider {

  private config: ClaudeProviderConfig;
  private inFlightRequests = new Map<string, InFlightRequest>();

  constructor(config: ClaudeProviderConfig) {
    this.config = config;
  }

  private resolveBaseUrl(): string {
    return this.config.baseUrl ?? 'https://api.anthropic.com/v1';
  }

  private createProviderError(status: number, errorText: string): Error {
    const error = new Error(`Provider error: ${status} - ${errorText}`);
    (error as any).status = status;
    (error as any).body = errorText;
    return error;
  }

  private generateCacheKey(messages: ChatMessage[], options: ChatOptions): string {
    return makeCacheKey('claude-chat', {
      model: this.config.model,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  }

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
    } finally {
      clearTimeout(timeoutId);
      if (cancelSignal) {
        cancelSignal.removeEventListener('abort', abortListener);
      }
    }
  }

  private async executeWithRetry(
    messages: ChatMessage[],
    options: ChatOptions,
    cancelSignal: AbortSignal,
    maxRetries: number = DEFAULT_MAX_RETRIES
  ): Promise<ChatCompletionResponse> {
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    const url = joinUrl(this.resolveBaseUrl(), '/messages');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': this.config.apiKey,
      ...this.config.customHeaders,
    };

    const { system, messages: anthropicMessages } = extractSystemPrompt(messages);
    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(system ? { system } : {}),
      messages: anthropicMessages,
    };

    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (cancelSignal.aborted) {
          throw Object.assign(new Error('Request was cancelled'), { name: 'AbortError' });
        }

        const response = await this.fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          },
          timeoutMs,
          cancelSignal
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw this.createProviderError(response.status, errorText);
        }

        return toChatCompletionResponse(await response.json());
      } catch (error) {
        lastError = error;
        const classified = classifyError(error);
        if (cancelSignal.aborted || !classified.retryable || attempt === maxRetries - 1) {
          throw error;
        }
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatCompletionResponse> {
    const cacheKey = this.generateCacheKey(messages, options);

    const existing = this.inFlightRequests.get(cacheKey);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const promise = this.executeWithRetry(messages, options, controller.signal).finally(() => {
      this.inFlightRequests.delete(cacheKey);
    });

    this.inFlightRequests.set(cacheKey, { promise, timestamp: Date.now(), controller });
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
    const baseUrl = this.config.baseUrl ?? 'https://api.anthropic.com/v1';
    const url = joinUrl(baseUrl, '/messages');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
      'x-api-key': this.config.apiKey,
      ...this.config.customHeaders,
    };

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
      const { system, messages: anthropicMessages } = extractSystemPrompt(messages);
      const body: Record<string, unknown> = {
        model: this.config.model,
        max_tokens: options.maxTokens,
        temperature: options.temperature,
        stream: true,
        ...(system ? { system } : {}),
        messages: anthropicMessages,
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

      const blockTypeByIndex: Record<number, string> = {};
      let content = '';
      let thinking = '';

      await parseSseStream(response, {
        signal: controller.signal,
        onData: (data) => {
          try {
            const parsed = JSON.parse(data);
            const type = typeof parsed?.type === 'string' ? parsed.type : '';
            const index = typeof parsed?.index === 'number' ? parsed.index : null;

            if (type === 'content_block_delta') {
              const blockType = index !== null ? blockTypeByIndex[index] : '';
              const deltaText = parsed?.delta?.text;
              const deltaThinking = parsed?.delta?.thinking;

              if (typeof deltaThinking === 'string' && deltaThinking) {
                thinking += deltaThinking;
                options.onThinkingDelta?.(deltaThinking);
                return;
              }

              if (typeof deltaText === 'string' && deltaText) {
                if (blockType === 'thinking') {
                  thinking += deltaText;
                  options.onThinkingDelta?.(deltaText);
                  return;
                }

                content += deltaText;
                options.onDelta(deltaText);
              }
              return;
            }

            if (type === 'content_block_start') {
              const contentBlock = parsed?.content_block;
              const contentBlockType = typeof contentBlock?.type === 'string' ? contentBlock.type : '';
              if (index !== null && contentBlockType) {
                blockTypeByIndex[index] = contentBlockType;
              }

              if (contentBlockType === 'thinking') {
                const initialThinking =
                  typeof contentBlock?.thinking === 'string'
                    ? contentBlock.thinking
                    : typeof contentBlock?.text === 'string'
                      ? contentBlock.text
                      : '';
                if (initialThinking) {
                  thinking += initialThinking;
                  options.onThinkingDelta?.(initialThinking);
                }
                return;
              }

              const text = contentBlock?.text;
              if (typeof text === 'string' && text) {
                content += text;
                options.onDelta(text);
              }
            }
          } catch {
            // Ignore malformed chunks.
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


  async testConnection(): Promise<{ ok: true } | { ok: false; error: ProviderError }> {
    try {
      await this.chat([{ role: 'user', content: 'Hello' }], { maxTokens: 1, timeout: 10000 });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: classifyError(error) };
    }
  }

  cancel(): void {
    for (const request of this.inFlightRequests.values()) {
      request.controller.abort();
    }
    this.inFlightRequests.clear();
  }
}

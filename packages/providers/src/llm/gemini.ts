import type { GeminiProviderConfig } from '@lexipath/core';
import { classifyError, type ProviderError } from '../errors';
import type { ChatCompletionResponse, ChatMessage, ChatOptions } from './openai-compatible';

interface InFlightRequest {
  promise: Promise<ChatCompletionResponse>;
  timestamp: number;
  controller: AbortController;
}

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const DEFAULT_MAX_TOKENS = 1000;

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function normalizeGeminiModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes('/')) return trimmed;
  return `models/${trimmed}`;
}

function extractSystemPrompt(messages: ChatMessage[]): {
  systemInstruction?: string;
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
} {
  const systemParts: string[] = [];
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) systemParts.push(message.content.trim());
      continue;
    }

    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content }] });
      continue;
    }

    if (message.role === 'assistant') {
      contents.push({ role: 'model', parts: [{ text: message.content }] });
      continue;
    }
  }

  const systemInstruction = systemParts.length ? systemParts.join('\n\n') : undefined;
  return { ...(systemInstruction ? { systemInstruction } : {}), contents };
}

function toChatCompletionResponse(input: unknown): ChatCompletionResponse {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid response from Gemini (expected object)');
  }

  const record = input as Record<string, unknown>;
  const candidates = record.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return {
      id: 'gemini',
      choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop' }],
    };
  }

  const candidate = candidates[0] as Record<string, unknown>;
  const finishReason =
    typeof candidate.finishReason === 'string'
      ? candidate.finishReason
      : typeof candidate.finish_reason === 'string'
        ? candidate.finish_reason
        : 'stop';

  const contentRecord = (candidate.content ?? {}) as Record<string, unknown>;
  const parts = contentRecord.parts;

  let text = '';
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (!part || typeof part !== 'object') continue;
      const partRecord = part as Record<string, unknown>;
      const chunk = typeof partRecord.text === 'string' ? partRecord.text : '';
      if (chunk) text += chunk;
    }
  }

  return {
    id: 'gemini',
    choices: [
      {
        message: { role: 'assistant', content: text },
        finish_reason: finishReason,
      },
    ],
  };
}

export class GeminiProvider {
  private config: GeminiProviderConfig;
  private inFlightRequests = new Map<string, InFlightRequest>();

  constructor(config: GeminiProviderConfig) {
    this.config = config;
  }

  private resolveBaseUrl(): string {
    return this.config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  private resolveUrl(): string {
    const model = normalizeGeminiModel(this.config.model);
    const path = `${model}:generateContent`;
    const base = joinUrl(this.resolveBaseUrl(), path);
    const url = new URL(base);
    url.searchParams.set('key', this.config.apiKey);
    return url.toString();
  }

  private createProviderError(status: number, errorText: string): Error {
    const error = new Error(`Provider error: ${status} - ${errorText}`);
    (error as any).status = status;
    (error as any).body = errorText;
    return error;
  }

  private generateCacheKey(messages: ChatMessage[], options: ChatOptions): string {
    const key = {
      provider: 'gemini',
      model: this.config.model,
      messages,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    };
    return JSON.stringify(key);
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
    const url = this.resolveUrl();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.config.customHeaders,
    };

    const { systemInstruction, contents } = extractSystemPrompt(messages);
    const body: Record<string, unknown> = {
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      contents,
      generationConfig: {
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        maxOutputTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      },
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

import browser from 'webextension-polyfill';
import { z } from 'zod';

import { ChatPayloadSchema } from '@lexipath/core';
import type { ClaudeProviderConfig, GeminiProviderConfig, ProviderConfig } from '@lexipath/core';
import { getErrorMessage } from '@lexipath/core/log';

import type { createConcurrencyManager } from '../lib/concurrency';
import { DEFAULT_CLAUDE_URL, DEFAULT_GEMINI_URL, DEFAULT_OPENAI_URL, getChatProviderByChannel, resolveChannel, resolveChannelRoute, routeKey } from '../lib/routing';
import type { Translator } from '../lib/i18n';
import { bumpDailyUsage } from '../usage-summary';

import { MessageError, type createMessageHandlerRegistry } from '../../shared/messages';
import { parseKeywordSessionId } from '../../shared/chat-session-id';
import { getSettings } from '../../shared/storage';
import { getStorageService } from '../../shared/storage-service';

type Registry = ReturnType<typeof createMessageHandlerRegistry>;
type ConcurrencyManager = ReturnType<typeof createConcurrencyManager>;

type StructuredStreamError = { code: string; message: string };

const CHAT_SESSIONS_LEGACY_STORAGE_KEY = 'lexipath_chat_sessions_v1';
const CHAT_MAX_HISTORY_MESSAGES = 20; // Max messages to keep in prompt history (10 pairs)

const ChatStreamStartMessageSchema = z
  .object({
    type: z.literal('START'),
    payload: ChatPayloadSchema,
  })
  .strict();

const LegacyChatSessionSchema = z
  .object({
    id: z.string().min(1),
    messages: z.array(
      z
        .object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
        })
        .strict()
    ),
    createdAt: z.number(),
    lastAccessedAt: z.number(),
  })
  .strict();

const LegacyStoredChatSessionsSchema = z
  .object({
    sessions: z.array(LegacyChatSessionSchema),
  })
  .strict();

let chatMigrationPromise: Promise<void> | null = null;

async function ensureChatMigrated(log: { warn: (...args: unknown[]) => void }): Promise<void> {
  if (chatMigrationPromise) return chatMigrationPromise;

  chatMigrationPromise = (async () => {
    const storageService = getStorageService();

    try {
      const already = await storageService.getMeta('migration_chat_v1');
      if (already) return;
    } catch (error: unknown) {
      log.warn('Chat migration meta read failed; will attempt migration anyway', error);
    }

    try {
      const raw = await browser.storage.local.get(CHAT_SESSIONS_LEGACY_STORAGE_KEY);
      const parsed = LegacyStoredChatSessionsSchema.safeParse(raw[CHAT_SESSIONS_LEGACY_STORAGE_KEY]);
      if (parsed.success) {
        for (const session of parsed.data.sessions) {
          await storageService.upsertSession({
            sessionId: session.id,
            keyword: '',
            conversationIndex: 0,
            createdAt: session.createdAt,
            lastAccessedAt: session.lastAccessedAt,
          });

          const baseTimestamp = session.createdAt || Date.now();
          for (const [idx, msg] of session.messages.entries()) {
            await storageService.addMessageWithoutTouchingSession({
              sessionId: session.id,
              role: msg.role,
              content: msg.content,
              timestamp: baseTimestamp + idx,
            });
          }
        }
      }
    } catch (error: unknown) {
      log.warn('Chat migration: failed to load legacy chat sessions; skipping migration', error);
    }

    try {
      await browser.storage.local.remove(CHAT_SESSIONS_LEGACY_STORAGE_KEY);
    } catch (error: unknown) {
      log.warn('Chat migration: failed to remove legacy storage key', error);
    }

    try {
      await storageService.setMeta('migration_chat_v1', true);
    } catch (error: unknown) {
      log.warn('Chat migration: failed to persist migration meta flag', error);
    }
  })().finally(() => {
    chatMigrationPromise = null;
  });

  return chatMigrationPromise;
}

function generateSessionId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

function toStructuredStreamError(t: Translator, error: unknown): StructuredStreamError {
  if (error instanceof MessageError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: error.message || t('error_unknown') };
  }
  return { code: 'INTERNAL_ERROR', message: t('error_unknown') };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function parseSseStream(
  response: Response,
  options: { onData: (data: string) => void; signal?: AbortSignal }
): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    if (options.signal?.aborted) break;
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const lines = part.split(/\r?\n/);
      const dataLines: string[] = [];
      for (const line of lines) {
        if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
      const data = dataLines.join('\n').trim();
      if (data) options.onData(data);
    }
  }
}

async function streamOpenAICompatibleChat(options: {
  config: ProviderConfig;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  onDelta: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  signal?: AbortSignal;
  log: { debug: (...args: unknown[]) => void };
}): Promise<string> {
  const baseUrl = options.config.baseUrl ?? DEFAULT_OPENAI_URL;
  const url = joinUrl(baseUrl, '/chat/completions');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.config.customHeaders,
  };
  if (options.config.apiKey) {
    headers['Authorization'] = `Bearer ${options.config.apiKey}`;
  }

  const body = {
    model: options.config.model,
    messages: options.messages,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    stream: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new MessageError({ code: 'PROVIDER_ERROR', message: `Provider error: ${response.status} - ${errorText}` });
  }

  let accumulated = '';
  await parseSseStream(response, {
    ...(options.signal ? { signal: options.signal } : {}),
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
          options.onThinkingDelta?.(thinkingDelta);
        }

        const delta =
          deltaRecord?.content ??
          deltaRecord?.text ??
          parsed?.choices?.[0]?.message?.content ??
          '';
        if (typeof delta === 'string' && delta) {
          accumulated += delta;
          options.onDelta(delta);
        }
      } catch (error: unknown) {
        options.log.debug('OpenAI SSE chunk parse failed; ignoring chunk', { message: getErrorMessage(error) });
      }
    },
  });

  return accumulated;
}

function extractClaudeSystemPrompt(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): { system?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }> } {
  const systemParts: string[] = [];
  const output: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const message of messages) {
    if (message.role === 'system') {
      if (message.content.trim()) systemParts.push(message.content.trim());
      continue;
    }
    if (message.role === 'user' || message.role === 'assistant') {
      output.push({ role: message.role, content: message.content });
    }
  }

  return { ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}), messages: output };
}

const ANTHROPIC_VERSION = '2023-06-01';

async function streamClaudeChat(options: {
  config: ClaudeProviderConfig;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  onDelta: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  signal?: AbortSignal;
  log: { debug: (...args: unknown[]) => void };
}): Promise<string> {
  const baseUrl = options.config.baseUrl ?? DEFAULT_CLAUDE_URL;
  const url = joinUrl(baseUrl, '/messages');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
    'x-api-key': options.config.apiKey,
    ...options.config.customHeaders,
  };

  const { system, messages } = extractClaudeSystemPrompt(options.messages);
  const body: Record<string, unknown> = {
    model: options.config.model,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
    stream: true,
    ...(system ? { system } : {}),
    messages,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new MessageError({ code: 'PROVIDER_ERROR', message: `Provider error: ${response.status} - ${errorText}` });
  }

  const blockTypeByIndex: Record<number, string> = {};

  let accumulated = '';
  await parseSseStream(response, {
    ...(options.signal ? { signal: options.signal } : {}),
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
            options.onThinkingDelta?.(deltaThinking);
            return;
          }

          if (typeof deltaText === 'string' && deltaText) {
            if (blockType === 'thinking') {
              options.onThinkingDelta?.(deltaText);
              return;
            }

            accumulated += deltaText;
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
            const thinking =
              typeof contentBlock?.thinking === 'string'
                ? contentBlock.thinking
                : typeof contentBlock?.text === 'string'
                  ? contentBlock.text
                  : '';
            if (thinking) {
              options.onThinkingDelta?.(thinking);
            }
            return;
          }

          const text = contentBlock?.text;
          if (typeof text === 'string' && text) {
            accumulated += text;
            options.onDelta(text);
          }
        }
      } catch (error: unknown) {
        options.log.debug('Claude SSE chunk parse failed; ignoring chunk', { message: getErrorMessage(error) });
      }
    },
  });

  return accumulated;
}

function normalizeGeminiModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes('/')) return trimmed;
  return `models/${trimmed}`;
}

function extractGeminiPrompts(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): {
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

async function streamGeminiChat(options: {
  config: GeminiProviderConfig;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  onDelta: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  signal?: AbortSignal;
  log: { debug: (...args: unknown[]) => void };
}): Promise<string> {
  const baseUrl = options.config.baseUrl ?? DEFAULT_GEMINI_URL;
  const model = normalizeGeminiModel(options.config.model);
  const url = new URL(joinUrl(baseUrl, `${model}:streamGenerateContent`));
  url.searchParams.set('key', options.config.apiKey);
  url.searchParams.set('alt', 'sse');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.config.customHeaders,
  };

  const { systemInstruction, contents } = extractGeminiPrompts(options.messages);
  const body: Record<string, unknown> = {
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    contents,
    generationConfig: {
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
    },
  };

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new MessageError({ code: 'PROVIDER_ERROR', message: `Provider error: ${response.status} - ${errorText}` });
  }

  let accumulated = '';
  let accumulatedThinking = '';
  await parseSseStream(response, {
    ...(options.signal ? { signal: options.signal } : {}),
    onData: (data) => {
      try {
        const parsed = JSON.parse(data);
        const candidates = parsed?.candidates;
        if (!Array.isArray(candidates) || candidates.length === 0) return;
        const content = candidates[0]?.content;
        const parts = content?.parts;
        if (!Array.isArray(parts)) return;
        let text = '';
        let thinkingText = '';
        for (const part of parts) {
          const chunk = part?.text;
          if (typeof chunk === 'string') text += chunk;

          const thinkingChunk =
            typeof part?.thinking === 'string'
              ? part.thinking
              : typeof part?.thought === 'string'
                ? part.thought
                : typeof part?.reasoning === 'string'
                  ? part.reasoning
                  : '';
          if (thinkingChunk) thinkingText += thinkingChunk;
        }

        if (text) {
          const delta = text.startsWith(accumulated) ? text.slice(accumulated.length) : text;
          if (delta) {
            accumulated += delta;
            options.onDelta(delta);
          }
        }

        if (thinkingText) {
          const thinkingDelta = thinkingText.startsWith(accumulatedThinking)
            ? thinkingText.slice(accumulatedThinking.length)
            : thinkingText;
          if (thinkingDelta) {
            accumulatedThinking += thinkingDelta;
            options.onThinkingDelta?.(thinkingDelta);
          }
        }
      } catch (error: unknown) {
        options.log.debug('Gemini SSE chunk parse failed; ignoring chunk', { message: getErrorMessage(error) });
      }
    },
  });

  return accumulated;
}

async function runChatStream(
  t: Translator,
  log: { warn: (...args: unknown[]) => void; debug: (...args: unknown[]) => void },
  concurrency: Pick<ConcurrencyManager, 'getChannelConcurrencyLimit' | 'runWithChannelConcurrency'>,
  payload: { message: string; conversationId?: string; backgroundInfo?: string },
  options: { onDelta: (delta: string) => void; onThinkingDelta?: (delta: string) => void; signal?: AbortSignal }
): Promise<{ reply: string; conversationId: string; thinking?: string }> {
  await ensureChatMigrated(log);

  const settings = await getSettings();
  const chatRoute = resolveChannelRoute('chat', settings);
  const chatChannel = resolveChannel(chatRoute.channelId, settings);
  const chatProviderInfo = chatChannel ? getChatProviderByChannel(chatChannel) : null;
  if (!chatChannel || !chatProviderInfo) {
    throw new MessageError({
      code: 'PROVIDER_NOT_CONFIGURED',
      message: t('error_providerNotConfigured'),
    });
  }

  void bumpDailyUsage({ task: 'chat', provider: chatProviderInfo.type, apiEvent: true, words: 0 });

  const sessionId = payload.conversationId ?? generateSessionId();
  const parsedSessionId = parseKeywordSessionId(sessionId);
  const storageService = getStorageService();
  const now = Date.now();

  const existing = await storageService.getSession(sessionId);
  if (!existing) {
    await storageService.upsertSession({
      sessionId,
      keyword: parsedSessionId?.keyword ?? '',
      conversationIndex: parsedSessionId?.conversationIndex ?? 0,
      createdAt: now,
      lastAccessedAt: now,
    });
  }

  const userMessageId = await storageService.addMessage({
    sessionId,
    role: 'user',
    content: payload.message,
    timestamp: now,
  });

  const history = await storageService.getMessages(sessionId, { limit: CHAT_MAX_HISTORY_MESSAGES });
  let accumulatedThinking = '';
  const backgroundInfo = typeof payload.backgroundInfo === 'string' ? payload.backgroundInfo.trim() : '';
  const handleThinkingDelta = (delta: string) => {
    if (!delta) return;
    accumulatedThinking += delta;
    options.onThinkingDelta?.(delta);
  };

  const systemMessage = {
    role: 'system' as const,
    content: `You are a helpful language learning assistant. The user's native language is ${settings.nativeLanguage} and they are learning ${settings.targetLanguage} at ${settings.proficiencyLevel} level. Please provide clear, helpful responses in their native language (${
      settings.nativeLanguage === 'zh-CN'
        ? 'Simplified Chinese'
        : settings.nativeLanguage === 'zh-TW'
          ? 'Traditional Chinese'
          : 'English'
    }).

Format your responses for readability:
- Use Markdown.
- Prefer short sections, lists, and examples.
- Use fenced code blocks for code.
- Ask clarifying questions at the end if needed.`,
  };

  if (backgroundInfo) {
    systemMessage.content += `\n\nBackground information:\n${backgroundInfo}\n`;
  }

  try {
    const limit = concurrency.getChannelConcurrencyLimit(chatChannel, chatRoute.kind);
    const reply = await concurrency.runWithChannelConcurrency(routeKey(chatRoute), limit, () => {
      const messages = [systemMessage, ...history.map((m) => ({ role: m.role, content: m.content }))] as Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
      }>;

      switch (chatProviderInfo.type) {
        case 'openai':
          return streamOpenAICompatibleChat({
            config: chatProviderInfo.config as ProviderConfig,
            messages,
            temperature: 0.7,
            maxTokens: 1000,
            onDelta: options.onDelta,
            onThinkingDelta: handleThinkingDelta,
            ...(options.signal ? { signal: options.signal } : {}),
            log,
          });
        case 'claude':
          return streamClaudeChat({
            config: chatProviderInfo.config as ClaudeProviderConfig,
            messages,
            temperature: 0.7,
            maxTokens: 1000,
            onDelta: options.onDelta,
            onThinkingDelta: handleThinkingDelta,
            ...(options.signal ? { signal: options.signal } : {}),
            log,
          });
        case 'gemini':
          return streamGeminiChat({
            config: chatProviderInfo.config as GeminiProviderConfig,
            messages,
            temperature: 0.7,
            maxTokens: 1000,
            onDelta: options.onDelta,
            onThinkingDelta: handleThinkingDelta,
            ...(options.signal ? { signal: options.signal } : {}),
            log,
          });
      }
    });

    const assistantReply = reply ?? '';
    if (!assistantReply.trim()) {
      throw new MessageError({
        code: 'EMPTY_RESPONSE',
        message: t('error_emptyResponse'),
      });
    }

    const thinking = accumulatedThinking.trim() ? accumulatedThinking : undefined;

    await storageService.addMessage({
      sessionId,
      role: 'assistant',
      content: assistantReply,
      ...(thinking ? { thinking } : {}),
      timestamp: Date.now(),
    });

    return { reply: assistantReply, conversationId: sessionId, ...(thinking ? { thinking } : {}) };
  } catch (error) {
    try {
      await storageService.deleteMessage(userMessageId);
    } catch (deleteError: unknown) {
      log.warn('Failed to roll back user message after chat error; message may remain in storage', {
        userMessageId,
        error: deleteError,
      });
    }
    throw error;
  }
}

export function registerChatFeature(options: {
  registry: Registry;
  t: Translator;
  log: { warn: (...args: unknown[]) => void; debug: (...args: unknown[]) => void };
  concurrency: Pick<ConcurrencyManager, 'getChannelConcurrencyLimit' | 'runWithChannelConcurrency'>;
}) {
  const { registry, t, log, concurrency } = options;

  registry.register('GET_CHAT_SESSIONS', async (payload) => {
    const storageService = getStorageService();
    if (payload?.keyword) {
      return storageService.getSessionsByKeyword(payload.keyword);
    }
    return storageService.listAllSessions();
  });

  registry.register('GET_CHAT_MESSAGES', async (payload) => {
    const storageService = getStorageService();
    if (!payload?.sessionId) {
      throw new MessageError({ code: 'INVALID_PAYLOAD', message: 'Expected sessionId' });
    }
    const limitOption = typeof payload.limit === 'number' ? { limit: payload.limit } : {};
    return storageService.getMessages(payload.sessionId, limitOption);
  });

  registry.register('CHAT', async (payload) => {
    let reply = '';
    const result = await runChatStream(
      t,
      log,
      concurrency,
      {
        message: payload.message,
        ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
        ...(payload.backgroundInfo ? { backgroundInfo: payload.backgroundInfo } : {}),
      },
      {
        onDelta: (delta) => {
          reply += delta;
        },
      }
    );
    return {
      reply: result.reply || reply,
      conversationId: result.conversationId,
      ...(result.thinking ? { thinking: result.thinking } : {}),
    };
  });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'LEXIPATH_CHAT_STREAM') return;

    let started = false;

    port.onMessage.addListener((message) => {
      if (started) return;
      const parsed = ChatStreamStartMessageSchema.safeParse(message);
      if (!parsed.success) return;
      const payload = parsed.data.payload;
      const startMessage = payload.message;
      const startConversationId = payload.conversationId;
      const startBackgroundInfo = payload.backgroundInfo;

      started = true;

      void (async () => {
        try {
          let reply = '';
          let thinking = '';
          const result = await runChatStream(
            t,
            log,
            concurrency,
            {
              message: startMessage,
              ...(startConversationId ? { conversationId: startConversationId } : {}),
              ...(startBackgroundInfo ? { backgroundInfo: startBackgroundInfo } : {}),
            },
            {
              onDelta: (delta) => {
                reply += delta;
                try {
                  port.postMessage({ type: 'CHUNK', delta });
                } catch (postError: unknown) {
                  log.debug('Failed to post CHUNK to chat stream port; ignoring', { message: getErrorMessage(postError) });
                }
              },
              onThinkingDelta: (delta) => {
                thinking += delta;
                try {
                  port.postMessage({ type: 'THINKING', delta });
                } catch (postError: unknown) {
                  log.debug('Failed to post THINKING to chat stream port; ignoring', { message: getErrorMessage(postError) });
                }
              },
            }
          );

          try {
            port.postMessage({
              type: 'DONE',
              reply: result.reply || reply,
              conversationId: result.conversationId,
              ...(typeof result.thinking === 'string' && result.thinking.trim()
                ? { thinking: result.thinking }
                : thinking.trim()
                  ? { thinking }
                  : {}),
            });
          } catch (postError: unknown) {
            log.debug('Failed to post DONE to chat stream port; ignoring', { message: getErrorMessage(postError) });
          }
        } catch (error) {
          const structured = toStructuredStreamError(t, error);
          try {
            port.postMessage({ type: 'ERROR', error: structured });
          } catch (postError: unknown) {
            log.debug('Failed to post ERROR to chat stream port; ignoring', { message: getErrorMessage(postError) });
          }
        } finally {
          try {
            port.disconnect();
          } catch (disconnectError: unknown) {
            log.debug('Failed to disconnect chat stream port; ignoring', { message: getErrorMessage(disconnectError) });
          }
        }
      })();
    });
  });
}


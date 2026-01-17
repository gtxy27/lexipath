import browser from 'webextension-polyfill';
import { z } from 'zod';

import { ChatPayloadSchema } from '@lexipath/core';
import { getErrorMessage } from '@lexipath/core/log';

import type { createConcurrencyManager } from '../lib/concurrency';
import { getChatProvider } from '../lib/providers';
import { getChatProviderByChannel, resolveChannel, resolveChannelRoute, routeKey } from '../lib/routing';
import type { Translator } from '../lib/i18n';
import { bumpDailyUsage } from '../usage-summary';


import { MessageError, type createMessageHandlerRegistry } from '../../shared/messages';
import { parseKeywordSessionId } from '../../shared/chat-session-id';
import { makeSubtitleAnchorKey, makeWebAnchorKey } from '../../shared/chat-anchor';
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
            kind: 'general',
            label: 'General',
            anchorKey: '',
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



async function runChatStream(
  t: Translator,
  log: { warn: (...args: unknown[]) => void; debug: (...args: unknown[]) => void },
  concurrency: Pick<ConcurrencyManager, 'getChannelConcurrencyLimit' | 'runWithChannelConcurrency'>,
  payload: {
    message: string;
    conversationId?: string;
    backgroundInfo?: string;
    sessionMeta?: {
      kind?: string | undefined;
      label?: string | undefined;
      anchorKey?: string | undefined;
      forceNewSession?: boolean | undefined;
      url?: string | undefined;
      anchorId?: string | undefined;
    };
  },
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

  const requestedMeta = payload.sessionMeta;
  const requestedAnchorKey = await (async () => {
    if (!requestedMeta) return '';

    const explicit = typeof requestedMeta.anchorKey === 'string' ? requestedMeta.anchorKey.trim() : '';
    if (explicit) return explicit;

    const kind = typeof requestedMeta.kind === 'string' ? requestedMeta.kind.trim() : '';

    if (kind === 'web') {
      // For web sessions, callers may include a URL only to compute a hashed anchorKey.
      const url = typeof requestedMeta.url === 'string' ? requestedMeta.url.trim() : '';
      return url ? await makeWebAnchorKey(url) : '';
    }

    if (kind === 'subtitle') {

      const anchorId = typeof requestedMeta.anchorId === 'string' ? requestedMeta.anchorId.trim() : '';
      return anchorId ? await makeSubtitleAnchorKey(anchorId) : '';
    }

    return '';
  })();

  const existing = await storageService.getSession(sessionId);
  if (!existing) {
    const keyword = parsedSessionId?.keyword ?? '';
    const kind = keyword.trim() ? 'keyword' : 'general';

    // If we have an anchor key and this isn't a forced-new session,
    // reuse the most recent session for that anchor.
    const wantsReuse = Boolean(requestedAnchorKey) && requestedMeta?.forceNewSession !== true;
    if (wantsReuse) {
      const allSessions = await storageService.listAllSessions();
      const reuse = allSessions
        .filter((s) => s.anchorKey === requestedAnchorKey)
        .sort((a, b) => b.lastAccessedAt - a.lastAccessedAt)[0];

      if (reuse) {
        // Continue the existing session instead of creating a new one.
        return runChatStream(
          t,
          log,
          concurrency,
          {
            ...payload,
            conversationId: reuse.sessionId,
          },
          options
        );
      }
    }

    await storageService.upsertSession({
      sessionId,
      keyword,
      conversationIndex: parsedSessionId?.conversationIndex ?? 0,
      createdAt: now,
      lastAccessedAt: now,
      kind,
      label: kind === 'keyword' ? keyword : 'General',
      anchorKey: '',
    });

  }

  const userMessageId = await storageService.addMessage({
    sessionId,
    role: 'user',
    content: payload.message,
    timestamp: now,
  });

  // If the caller has better metadata for this session, persist it.
  // This keeps history labels/kinds consistent with the UI entry points.
  const meta = payload.sessionMeta;
  if (meta && (meta.kind || meta.label || meta.anchorKey || requestedAnchorKey)) {
    try {
      const existingSession = await storageService.getSession(sessionId);
      const nextKind = typeof meta.kind === 'string' && meta.kind.trim() ? meta.kind.trim() : undefined;
      const nextLabel = typeof meta.label === 'string' && meta.label.trim() ? meta.label.trim() : undefined;
      const explicitAnchorKey = typeof meta.anchorKey === 'string' && meta.anchorKey.trim() ? meta.anchorKey.trim() : undefined;
      const nextAnchorKey = explicitAnchorKey ?? (requestedAnchorKey ? requestedAnchorKey : undefined);

      if (existingSession && (nextKind || nextLabel || nextAnchorKey)) {
        await storageService.upsertSession({
          ...existingSession,
          ...(nextKind ? { kind: nextKind as any } : {}),
          ...(nextLabel ? { label: nextLabel } : {}),
          ...(nextAnchorKey ? { anchorKey: nextAnchorKey } : {}),
        });
      }
    } catch (error: unknown) {
      log.warn('Failed to persist chat session metadata; continuing without metadata update', error);
    }
  }

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

      const provider = getChatProvider(chatProviderInfo.type, chatProviderInfo.config);
      return provider
        .streamChat(messages, {
          temperature: 0.7,
          maxTokens: 1000,
          onDelta: options.onDelta,
          onThinkingDelta: handleThinkingDelta,
          ...(options.signal ? { signal: options.signal } : {}),
        })
        .then((result) => result.content);

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
          ...(payload.sessionMeta
            ? {
                sessionMeta: {
                  ...(payload.sessionMeta.kind ? { kind: payload.sessionMeta.kind } : {}),
                  ...(payload.sessionMeta.label ? { label: payload.sessionMeta.label } : {}),
                  ...(payload.sessionMeta.anchorKey ? { anchorKey: payload.sessionMeta.anchorKey } : {}),
                  ...(payload.sessionMeta.url ? { url: payload.sessionMeta.url } : {}),
                  ...(payload.sessionMeta.anchorId ? { anchorId: payload.sessionMeta.anchorId } : {}),
                },
              }
            : {}),
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
                ...(payload.sessionMeta
                  ? {
                      sessionMeta: {
                        ...(payload.sessionMeta.kind ? { kind: payload.sessionMeta.kind } : {}),
                        ...(payload.sessionMeta.label ? { label: payload.sessionMeta.label } : {}),
                        ...(payload.sessionMeta.anchorKey ? { anchorKey: payload.sessionMeta.anchorKey } : {}),
                        ...(payload.sessionMeta.url ? { url: payload.sessionMeta.url } : {}),
                        ...(payload.sessionMeta.anchorId ? { anchorId: payload.sessionMeta.anchorId } : {}),
                      },
                    }
                  : {}),
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


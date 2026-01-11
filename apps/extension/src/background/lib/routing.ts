import {
  ClaudeProviderConfigSchema,
  GeminiProviderConfigSchema,
  ProviderConfigSchema,
  type ClaudeProviderConfig,
  type GeminiProviderConfig,
  type LLMProviderChannel,
  type ProviderChannel,
  type ProviderConfig,
  type RouteConfig,
  type RouteKind,
  type Settings,
} from '@lexipath/core';

export type ResolvedRoute = { kind: RouteKind; channelId?: number };

export const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1';
export const DEFAULT_CLAUDE_URL = 'https://api.anthropic.com/v1';
export const DEFAULT_GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';

export function resolveChannel(channelId: number | undefined, settings: Settings): ProviderChannel | null {
  if (typeof channelId !== 'number' || !Number.isFinite(channelId)) return null;
  return settings.channels.find((channel) => channel.channelId === channelId) ?? null;
}

function firstAvailableChannel(settings: Settings): ProviderChannel | null {
  let best: ProviderChannel | null = null;
  for (const channel of settings.channels) {
    if (!best || channel.channelId < best.channelId) best = channel;
  }
  return best;
}

function fallbackToFirstChannel(settings: Settings): ResolvedRoute {
  const first = firstAvailableChannel(settings);
  return { kind: 1, ...(first ? { channelId: first.channelId } : {}) };
}

export function resolveRoute(behaviorKey: string, settings: Settings): ResolvedRoute {
  const config = (settings.behaviorRoutes?.[behaviorKey] ?? null) as RouteConfig | null;
  if (!config) return fallbackToFirstChannel(settings);

  if (config.kind === 2 || config.kind === 3) {
    return { kind: config.kind };
  }

  const channel = resolveChannel(config.channelId, settings);
  if (channel) return { kind: 1, channelId: channel.channelId };
  return fallbackToFirstChannel(settings);
}

export function resolveChannelRoute(behaviorKey: string, settings: Settings): ResolvedRoute {
  const resolved = resolveRoute(behaviorKey, settings);
  if (resolved.kind !== 1) return fallbackToFirstChannel(settings);
  if (typeof resolved.channelId === 'number') return resolved;
  return fallbackToFirstChannel(settings);
}

export function routeKey(resolved: ResolvedRoute): string {
  if (resolved.kind === 2) return 'google';
  if (resolved.kind === 3) return 'bing';
  return `channel:${resolved.channelId ?? 'none'}`;
}

export function routeIdentity(resolved: ResolvedRoute, settings: Settings): Record<string, unknown> {
  if (resolved.kind === 2) return { kind: 'google' };
  if (resolved.kind === 3) return { kind: 'bing' };
  const channel = resolveChannel(resolved.channelId, settings);
  if (!channel) return { kind: 'channel', channelId: resolved.channelId ?? null };
  return {
    kind: 'channel',
    channelId: channel.channelId,
    typeId: channel.typeId,
    model: channel.model,
    baseUrl: typeof (channel.config as any)?.baseUrl === 'string' ? (channel.config as any).baseUrl : '',
  };
}

function llmTypeForChannel(channel: ProviderChannel): LLMProviderChannel | null {
  if (channel.typeId === 1) return 'openai';
  if (channel.typeId === 2) return 'claude';
  if (channel.typeId === 3) return 'gemini';
  return null;
}

export function getChatProviderByChannel(
  channel: ProviderChannel
): { type: LLMProviderChannel; config: ProviderConfig | ClaudeProviderConfig | GeminiProviderConfig } | null {
  const type = llmTypeForChannel(channel);
  if (!type) return null;

  const config = channel.config as Record<string, unknown>;
  const customHeaders =
    config.customHeaders && typeof config.customHeaders === 'object'
      ? (config.customHeaders as Record<string, unknown>)
      : undefined;
  const normalizedHeaders =
    customHeaders && Object.values(customHeaders).every((value) => typeof value === 'string')
      ? (customHeaders as Record<string, string>)
      : undefined;

  if (type === 'openai') {
    const parsed = ProviderConfigSchema.safeParse({
      baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl : DEFAULT_OPENAI_URL,
      model: channel.model,
      ...(typeof config.apiKey === 'string' ? { apiKey: config.apiKey } : {}),
      ...(normalizedHeaders ? { customHeaders: normalizedHeaders } : {}),
    });
    if (!parsed.success) return null;
    return { type, config: parsed.data };
  }

  if (type === 'claude') {
    const parsed = ClaudeProviderConfigSchema.safeParse({
      model: channel.model,
      apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
      baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl : DEFAULT_CLAUDE_URL,
      ...(normalizedHeaders ? { customHeaders: normalizedHeaders } : {}),
    });
    if (!parsed.success) return null;
    return { type, config: parsed.data };
  }

  const parsed = GeminiProviderConfigSchema.safeParse({
    model: channel.model,
    apiKey: typeof config.apiKey === 'string' ? config.apiKey : '',
    baseUrl: typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl : DEFAULT_GEMINI_URL,
    ...(normalizedHeaders ? { customHeaders: normalizedHeaders } : {}),
  });
  if (!parsed.success) return null;
  return { type, config: parsed.data };
}


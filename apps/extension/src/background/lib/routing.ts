import {
  ClaudeProviderConfigSchema,
  GeminiProviderConfigSchema,
  ProviderConfigSchema,
  type ClaudeProviderConfig,
  type GeminiProviderConfig,
  type LLMProviderChannel,
  type ProviderChannel,
  type ProviderConfig,
} from '@lexipath/core';
export { resolveChannel, resolveChannelRoute, resolveRoute, routeIdentity, routeKey, type ResolvedRoute } from '@lexipath/core';

export const DEFAULT_OPENAI_URL = 'https://api.openai.com/v1';
export const DEFAULT_CLAUDE_URL = 'https://api.anthropic.com/v1';
export const DEFAULT_GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta';

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


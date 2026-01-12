import type { ProviderChannel, RouteKind, Settings } from './types';

export type ResolvedRoute = { kind: RouteKind; channelId?: number };

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
  const config = (settings.behaviorRoutes?.[behaviorKey] ?? null) as { kind: RouteKind; channelId?: number } | null;
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


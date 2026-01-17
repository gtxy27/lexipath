import type { SidebarContextInfo } from './types';

type PendingSidebarMessage = {
  nonce?: string;
  text: string;
  keyword?: string;
  contextInfo?: SidebarContextInfo;
  timestamp: number;
  isAutoSend?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function parsePendingSidebarMessage(raw: unknown): PendingSidebarMessage | null {
  if (!isRecord(raw)) return null;

  const text = typeof raw.text === 'string' ? raw.text : '';
  const timestamp = typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp) ? raw.timestamp : 0;

  if (!text.trim()) return null;
  if (!timestamp) return null;

  const nonce = typeof raw.nonce === 'string' && raw.nonce.trim() ? raw.nonce.trim() : undefined;
  const keyword = typeof raw.keyword === 'string' && raw.keyword.trim() ? raw.keyword.trim() : undefined;
  const isAutoSend = typeof raw.isAutoSend === 'boolean' ? raw.isAutoSend : undefined;

  const contextInfoRaw = raw.contextInfo;
  const contextInfo = (() => {
    if (!isRecord(contextInfoRaw)) return undefined;
    if (contextInfoRaw.kind === 'subtitle') {
      const title = typeof contextInfoRaw.title === 'string' ? contextInfoRaw.title : undefined;
      const platform = typeof contextInfoRaw.platform === 'string' ? contextInfoRaw.platform : undefined;
      const timestampSec = typeof contextInfoRaw.timestampSec === 'number' ? contextInfoRaw.timestampSec : undefined;
      const lines = Array.isArray(contextInfoRaw.lines)
        ? contextInfoRaw.lines.map((l) => String(l ?? '')).filter((l) => l.trim())
        : undefined;

      const anchorId = typeof contextInfoRaw.anchorId === 'string' ? contextInfoRaw.anchorId : undefined;
      const url = typeof contextInfoRaw.url === 'string' ? contextInfoRaw.url : undefined;

      const parsed: SidebarContextInfo = {
        kind: 'subtitle',
        ...(platform ? { platform } : {}),
        ...(title ? { title } : {}),
        ...(typeof timestampSec === 'number' && Number.isFinite(timestampSec) ? { timestampSec } : {}),
        ...(lines && lines.length ? { lines } : {}),
        ...(anchorId ? { anchorId } : {}),
        ...(url ? { url } : {}),
      };

      return parsed;
    }

      if (contextInfoRaw.kind === 'web') {
      const title = typeof contextInfoRaw.title === 'string' ? contextInfoRaw.title : undefined;
      const domain = typeof contextInfoRaw.domain === 'string' ? contextInfoRaw.domain : undefined;
      const url = typeof contextInfoRaw.url === 'string' ? contextInfoRaw.url : undefined;
      const selectedText = typeof contextInfoRaw.selectedText === 'string' ? contextInfoRaw.selectedText : undefined;
      const beforeText = typeof contextInfoRaw.beforeText === 'string' ? contextInfoRaw.beforeText : undefined;
      const afterText = typeof contextInfoRaw.afterText === 'string' ? contextInfoRaw.afterText : undefined;

      const source = contextInfoRaw.source === 'study' ? 'study' : contextInfoRaw.source === 'selection' ? 'selection' : undefined;

      const parsed: SidebarContextInfo = {
        kind: 'web',
        ...(source ? { source } : {}),
        ...(title ? { title } : {}),
        ...(domain ? { domain } : {}),
        ...(url ? { url } : {}),
        ...(selectedText ? { selectedText } : {}),
        ...(beforeText ? { beforeText } : {}),
        ...(afterText ? { afterText } : {}),
      };

      return parsed;
    }

    return undefined;

  })();

  return {
    ...(nonce ? { nonce } : {}),
    text,
    ...(keyword ? { keyword } : {}),
    ...(contextInfo ? { contextInfo } : {}),
    timestamp,
    ...(isAutoSend !== undefined ? { isAutoSend } : {}),
  };
}

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
    if (contextInfoRaw.kind !== 'subtitle') return undefined;

    const title = typeof contextInfoRaw.title === 'string' ? contextInfoRaw.title : undefined;
    const platform = typeof contextInfoRaw.platform === 'string' ? contextInfoRaw.platform : undefined;
    const timestampSec = typeof contextInfoRaw.timestampSec === 'number' ? contextInfoRaw.timestampSec : undefined;
    const lines = Array.isArray(contextInfoRaw.lines)
      ? contextInfoRaw.lines.map((l) => String(l ?? '')).filter((l) => l.trim())
      : undefined;

    const parsed: SidebarContextInfo = {
      kind: 'subtitle',
      ...(platform ? { platform } : {}),
      ...(title ? { title } : {}),
      ...(typeof timestampSec === 'number' && Number.isFinite(timestampSec) ? { timestampSec } : {}),
      ...(lines && lines.length ? { lines } : {}),
    };

    return parsed;
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

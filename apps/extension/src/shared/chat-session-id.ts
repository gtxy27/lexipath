export function normalizeChatKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

export function makeKeywordSessionId(keyword: string, conversationIndex: number): string {
  const normalizedKeyword = normalizeChatKeyword(keyword);
  const index = Math.max(1, Math.floor(conversationIndex));
  return `kw:${encodeURIComponent(normalizedKeyword)}:${index}`;
}

export function parseKeywordSessionId(
  sessionId: string
): { keyword: string; conversationIndex: number } | null {
  const match = /^kw:([^:]+):(\d+)$/.exec(sessionId);
  if (!match) return null;
  const rawKeyword = match[1];
  const rawIndex = match[2];
  if (!rawKeyword || !rawIndex) return null;
  const keyword = decodeURIComponent(rawKeyword);
  const conversationIndex = Number(rawIndex);
  if (!Number.isFinite(conversationIndex) || conversationIndex < 1) return null;
  return { keyword, conversationIndex };
}

export function looksLikeUrlOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const tokens = trimmed.split(/\s+/g).filter(Boolean);
  if (tokens.length === 0) return false;

  const urlLike = (token: string): boolean => {
    const value = token.trim();
    if (!value) return false;
    if (/^https?:\/\//i.test(value)) return true;
    if (/^www\./i.test(value)) return true;
    if (/^[a-z0-9-]+\.[a-z]{2,}(\/|$)/i.test(value)) return true;
    return false;
  };

  return tokens.every(urlLike);
}

export function containsEnglishSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const words = trimmed.match(/[A-Za-z]{2,}/g) ?? [];
  return words.length >= 2;
}


import { SupportedLanguageSchema, type SupportedLanguage } from "./types";

export function normalizeWordbookTerm(term: string): string {
  return String(term ?? "").trim().toLowerCase();
}

export function normalizeWordbookLanguage(
  value: unknown,
  fallback: SupportedLanguage = "en",
): SupportedLanguage {
  const parsed = SupportedLanguageSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

export function makeWordbookEntryId(language: SupportedLanguage, term: string): string {
  const normalizedTerm = normalizeWordbookTerm(term);
  return `${language}:${normalizedTerm}`;
}


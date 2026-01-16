import type { Settings } from "@lexipath/core";

export function computeTextSignature(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash << 5) + hash + normalized.charCodeAt(i);
    hash |= 0;
  }

  return `${normalized.length}:${hash >>> 0}`;
}

export function extractTextContent(element: Element, maxTextLength: number): string {
  const stored = (element as HTMLElement | null)?.dataset?.lxOriginalText;
  const text =
    (typeof stored === "string" && stored.trim() ? stored.trim() : element.textContent?.trim()) || "";
  return text.slice(0, maxTextLength);
}

export function normalizeWordKey(raw: string): string {
  return raw.trim().toLowerCase();
}

export function getResolvedTheme(settings: Settings | null): "light" | "dark" {
  if (!settings) return "dark";
  if (settings.theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return settings.theme === "dark" ? "dark" : "light";
}

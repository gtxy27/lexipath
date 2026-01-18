import { resolveWebContentScope } from "./web-content-scope";

export type StudyContext = {
  beforeText?: string;
  selectedText?: string;
};

function normalizeText(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function getPageDescription(): string {
  const fromName = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
  if (fromName.trim()) return normalizeText(fromName);

  const fromOg = document.querySelector('meta[property="og:description"]')?.getAttribute("content") ?? "";
  if (fromOg.trim()) return normalizeText(fromOg);

  return "";
}

function isInReadWindow(el: Element, preloadScreens: number): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect?.();
  if (!rect) return false;

  const height = window.innerHeight || document.documentElement.clientHeight || 0;
  const width = window.innerWidth || document.documentElement.clientWidth || 0;
  const maxTop = height * (1 + preloadScreens);

  return rect.bottom > 0 && rect.right > 0 && rect.top < maxTop && rect.left < width;
}

function isLikelyChromeText(text: string): boolean {
  const t = text.toLowerCase();
  // Keep this list short; treat it as a low-confidence filter.
  return (
    t === "home" ||
    t === "top stories" ||
    t === "sign in" ||
    t.includes("log in") ||
    t.includes("ログイン") ||
    t.includes("ホーム")
  );
}

function extractHeadlines(root: Element, options: { preloadScreens: number; maxItems: number }): string {
  const { preloadScreens, maxItems } = options;

  const candidates = Array.from(root.querySelectorAll("h1, h2, h3, h4, [role=\"heading\"], a"));
  const seen = new Set<string>();
  const headlines: string[] = [];

  for (const el of candidates) {
    if (headlines.length >= maxItems) break;
    if (!isInReadWindow(el, preloadScreens)) continue;

    // Avoid obvious navigation containers.
    if (el.closest("nav, header, footer, aside")) continue;

    // Prefer heading text within links when available.
    const link = el.tagName.toLowerCase() === "a" ? el : el.closest("a");
    const raw = (link?.textContent ?? el.textContent) ?? "";
    const text = normalizeText(raw);

    if (text.length < 4) continue;
    if (text.length > 220) continue;
    if (isLikelyChromeText(text)) continue;
    if (seen.has(text)) continue;

    seen.add(text);
    headlines.push(text);
  }

  return headlines.length ? headlines.map((t, i) => `${i + 1}. ${t}`).join("\n") : "";
}

function extractBoundedExcerptFromScope(
  scope: {
    iterateTextElements: (options?: { maxElements?: number; maxNodes?: number }) => IterableIterator<Element>;
    shouldProcessElement: (el: Element) => boolean;
  },
  maxChars: number,
): string {
  const parts: string[] = [];
  let total = 0;

  for (const el of scope.iterateTextElements({ maxElements: 800, maxNodes: 120_000 })) {
    if (!scope.shouldProcessElement(el)) continue;
    const text = normalizeText(el.textContent ?? "");
    if (!text) continue;

    const remaining = maxChars - total;
    if (remaining <= 0) break;

    const slice = text.length > remaining ? text.slice(0, remaining) : text;
    parts.push(slice);
    total += slice.length;
  }

  return parts.join("\n\n").trim();
}

function computeArticleLike(scope: {
  iterateTextElements: (options?: { maxElements?: number; maxNodes?: number }) => IterableIterator<Element>;
  shouldProcessElement: (el: Element) => boolean;
}): boolean {
  let totalChars = 0;
  let paragraphCount = 0;
  let longParagraphs = 0;

  for (const el of scope.iterateTextElements({ maxElements: 800, maxNodes: 120_000 })) {
    if (!scope.shouldProcessElement(el)) continue;
    const text = normalizeText(el.textContent ?? "");
    if (!text) continue;

    totalChars += text.length;
    if (el.tagName.toLowerCase() === "p") {
      paragraphCount += 1;
      if (text.length >= 120) longParagraphs += 1;
    }

    if (totalChars >= 2400) break;
  }

  const hasArticle = Boolean(document.querySelector("article"));
  const hasMain = Boolean(document.querySelector("main"));

  if (totalChars >= 1400 && paragraphCount >= 4) return true;
  if ((hasArticle || hasMain) && totalChars >= 900 && paragraphCount >= 3) return true;
  if (longParagraphs >= 2 && totalChars >= 1100) return true;
  return false;
}

export function buildStudyContext(
  url: string,
  options?: { preloadScreens?: number; maxItems?: number; maxChars?: number },
): StudyContext {
  const scope = resolveWebContentScope(url);

  const preloadScreens = options?.preloadScreens ?? 2;
  const maxItems = options?.maxItems ?? 30;
  const maxChars = options?.maxChars ?? 1200;

  const beforeText = getPageDescription();

  const root = scope.root;

  const selectedText = (() => {
    const isArticle = computeArticleLike(scope);
    if (isArticle) {
      const excerpt = extractBoundedExcerptFromScope(scope, maxChars);
      if (excerpt) return excerpt;
    }

    // Fallback for non-article pages: try a bounded list of visible headings.
    return extractHeadlines(root, { preloadScreens, maxItems });
  })();

  return {
    ...(beforeText ? { beforeText } : {}),
    ...(selectedText ? { selectedText } : {}),
  };
}

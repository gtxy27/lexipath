import { WEB_SITE_ADAPTERS } from "./site-adapters/index";

export type WebSiteAdapter = Readonly<{
  id: string;
  textSelector: string;
  shouldQueueElement: (element: Element) => boolean;
  shouldProcessElement: (element: Element) => boolean;
}>;

export type WebSiteAdapterFactory = Readonly<{
  id: string;
  /**
   * Whether this adapter applies to the given URL.
   * Must be fast and side-effect free.
   */
  matches: (url: URL) => boolean;
  create: () => WebSiteAdapter;
}>;

const DEFAULT_TEXT_SELECTOR = [
  "p",
  "article p",
  "main p",
  ".content p",
  ".article-content p",
  'div[class*="content"] p',
  'div[class*="article"] p',
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "td",
  "blockquote",
].join(", ");

function defaultShouldQueueElement(element: Element): boolean {
  const tagName = element.tagName.toLowerCase();
  const skipTags = [
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "video",
    "audio",
    "input",
    "textarea",
    "select",
    "button",
    "code",
    "pre",
  ];
  if (skipTags.includes(tagName)) return false;

  if (element.getAttribute("contenteditable") === "true") return false;

  return true;
}

function defaultShouldProcessElement(element: Element): boolean {
  if (!defaultShouldQueueElement(element)) return false;

  if (element.hasAttribute("hidden")) return false;

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;

  return true;
}

const defaultAdapter: WebSiteAdapter = Object.freeze({
  id: "default",
  textSelector: DEFAULT_TEXT_SELECTOR,
  shouldQueueElement: defaultShouldQueueElement,
  shouldProcessElement: defaultShouldProcessElement,
});

function safeParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function getWebSiteAdapter(url: string): WebSiteAdapter {
  const parsed = safeParseUrl(url);
  if (!parsed) return defaultAdapter;

  for (const factory of WEB_SITE_ADAPTERS) {
    try {
      if (factory.matches(parsed)) {
        return Object.freeze(factory.create());
      }
    } catch {
      // Ignore adapter failures; fall back to default.
    }
  }

  return defaultAdapter;
}

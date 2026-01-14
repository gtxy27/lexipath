export type WebSiteAdapter = Readonly<{
  id: string;
  textSelector: string;
  shouldQueueElement: (element: Element) => boolean;
  shouldProcessElement: (element: Element) => boolean;
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

export function getWebSiteAdapter(url: string): WebSiteAdapter {
  const hostname = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();

  // Future: add per-site overrides here.
  void hostname;

  return Object.freeze({
    id: "default",
    textSelector: DEFAULT_TEXT_SELECTOR,
    shouldQueueElement: defaultShouldQueueElement,
    shouldProcessElement: defaultShouldProcessElement,
  });
}


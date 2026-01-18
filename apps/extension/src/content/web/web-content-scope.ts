import { getWebSiteProfile } from "./site-profiles";

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

const DEFAULT_EXCLUDE_SELECTOR = [
  "nav",
  "header",
  "footer",
  "aside",
  "[role=\"navigation\"]",
  "[role=\"banner\"]",
  "[role=\"contentinfo\"]",
].join(", ");

function defaultShouldQueueElement(element: Element, options: { excludeSelector?: string }): boolean {
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

  const excludeSelector = options.excludeSelector;
  if (excludeSelector) {
    try {
      if (element.closest(excludeSelector)) return false;
    } catch {
      // Ignore invalid exclusion selectors.
    }
  }

  return true;
}

function defaultShouldProcessElement(element: Element, options: { excludeSelector?: string }): boolean {
  if (!defaultShouldQueueElement(element, options)) return false;

  if (element.hasAttribute("hidden")) return false;

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;

  return true;
}

export type WebContentScope = Readonly<{
  profileId: string;
  root: Element;
  textSelector: string;
  excludeSelector?: string;
  shouldQueueElement: (element: Element) => boolean;
  shouldProcessElement: (element: Element) => boolean;
  /**
   * Iterates candidate elements in DOM order within the resolved root.
   * Intended for queueing/scanning; consumers MAY apply additional filtering.
   */
  iterateTextElements: (options?: {
    maxElements?: number;
    maxNodes?: number;
    signal?: AbortSignal;
  }) => IterableIterator<Element>;
}>;

export function resolveWebContentScope(url: string): WebContentScope {
  const profile = getWebSiteProfile(url);

  const textSelector = profile.textSelector ?? DEFAULT_TEXT_SELECTOR;
  const excludeSelector = profile.excludeSelector ?? DEFAULT_EXCLUDE_SELECTOR;

  const root = (() => {
    try {
      return (
        document.querySelector(profile.rootSelector) ??
        document.querySelector("main") ??
        document.querySelector("article") ??
        document.body
      );
    } catch {
      return document.body;
    }
  })();

  const shouldQueueElement = (element: Element) =>
    defaultShouldQueueElement(element, { excludeSelector });
  const shouldProcessElement = (element: Element) =>
    defaultShouldProcessElement(element, { excludeSelector });

  const iterateTextElements: WebContentScope["iterateTextElements"] = function* (
    options,
  ): IterableIterator<Element> {
    const maxElements = options?.maxElements ?? Number.POSITIVE_INFINITY;
    const maxNodes = options?.maxNodes ?? Number.POSITIVE_INFINITY;
    const signal = options?.signal;

    const stack: Element[] = [root];
    let visited = 0;
    let yielded = 0;

    while (stack.length > 0) {
      if (signal?.aborted) return;

      const el = stack.pop();
      if (!el) continue;

      visited += 1;
      if (visited > maxNodes) return;

      if (excludeSelector) {
        try {
          if (el.matches(excludeSelector)) {
            // Skip excluded containers and their descendants.
            continue;
          }
        } catch {
          // Ignore invalid exclusion selectors.
        }
      }

      const children = el.children;
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children.item(i);
        if (child) stack.push(child);
      }

      if (!shouldQueueElement(el)) continue;

      try {
        if (el.matches(textSelector)) {
          yielded += 1;
          if (yielded > maxElements) return;
          yield el;
        }
      } catch {
        // Ignore invalid text selectors.
      }
    }
  };

  return {
    profileId: profile.id,
    root,
    textSelector,
    excludeSelector,
    shouldQueueElement,
    shouldProcessElement,
    iterateTextElements,
  };
}


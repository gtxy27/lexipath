import type { WebSiteAdapterFactory } from "../site-adapters";

function shouldQueueElement(element: Element): boolean {
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
  ];
  if (skipTags.includes(tagName)) return false;
  if (element.getAttribute("contenteditable") === "true") return false;
  return true;
}

function shouldProcessElement(element: Element): boolean {
  if (!shouldQueueElement(element)) return false;
  if (element.hasAttribute("hidden")) return false;

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;

  return true;
}

export const googleNewsAdapter: WebSiteAdapterFactory = {
  id: "google-news",
  matches: (url) => url.hostname === "news.google.com",
  create: () => ({
    id: "google-news",
    // Keep selectors broad; the upper-layer extractor chooses headlines vs excerpt.
    textSelector: "main h1, main h2, main h3, main h4, main [role=\"heading\"], main p, main li",
    shouldQueueElement,
    shouldProcessElement,
  }),
};

import type { WebSiteProfile } from "../site-profiles";

export const googleNewsProfile: WebSiteProfile = Object.freeze({
  id: "google-news",
  matches: (url) => url.hostname === "news.google.com",
  rootSelector: "main, body",
  // Keep selectors broad; the upper-layer extractor chooses headlines vs excerpt.
  textSelector:
    'main h1, main h2, main h3, main h4, main [role="heading"], main p, main li',
});


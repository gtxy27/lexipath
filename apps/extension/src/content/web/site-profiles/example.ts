import type { WebSiteProfile } from "../site-profiles";

// Template profile.
// 1) Copy this file to a site-specific name (e.g. zhihu.ts)
// 2) Implement matches() + selectors
// 3) Add it to WEB_SITE_PROFILES in ./index.ts
export const exampleProfile: WebSiteProfile = Object.freeze({
  id: "example",
  matches: (_url) => false,
  rootSelector: "article, main, body",
  textSelector: "article p",
});


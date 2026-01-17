import type { WebSiteAdapterFactory } from "../site-adapters";

// Template adapter.
// 1) Copy this file to a site-specific name (e.g. zhihu.ts)
// 2) Implement matches() + adapter behavior
// 3) Add it to WEB_SITE_ADAPTERS in ./index.ts

export const exampleAdapter: WebSiteAdapterFactory = {
  id: "example",
  matches: (_url) => false,
  create: () => ({
    id: "example",
    textSelector: "article p",
    shouldQueueElement: () => true,
    shouldProcessElement: () => true,
  }),
};

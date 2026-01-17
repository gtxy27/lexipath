import type { WebSiteAdapterFactory } from "../site-adapters";

import { googleNewsAdapter } from "./google-news";

// Keep built-in adapters centralized so adding a new site is a single import + array entry.
export const WEB_SITE_ADAPTERS: ReadonlyArray<WebSiteAdapterFactory> = [googleNewsAdapter];

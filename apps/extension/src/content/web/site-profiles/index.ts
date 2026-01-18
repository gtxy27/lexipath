import type { WebSiteProfile } from "../site-profiles";
import { exampleProfile } from "./example";
import { googleNewsProfile } from "./google-news";

export const WEB_SITE_PROFILES: WebSiteProfile[] = [
  googleNewsProfile,
  exampleProfile,
];


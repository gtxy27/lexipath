import { WEB_SITE_PROFILES } from "./site-profiles/index";

export type WebSiteProfile = Readonly<{
  id: string;
  /**
   * Whether this profile applies to the given URL.
   * Must be fast and side-effect free.
   */
  matches: (url: URL) => boolean;
  rootSelector: string;
  excludeSelector?: string;
  textSelector?: string;
}>;

const DEFAULT_PROFILE: WebSiteProfile = Object.freeze({
  id: "default",
  matches: () => false,
  rootSelector: "article, main, body",
});

function safeParseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function getWebSiteProfile(url: string): WebSiteProfile {
  const parsed = safeParseUrl(url);
  if (!parsed) return DEFAULT_PROFILE;

  for (const profile of WEB_SITE_PROFILES) {
    try {
      if (profile.matches(parsed)) return profile;
    } catch {
      // Ignore profile failures; fall back to default.
    }
  }

  return DEFAULT_PROFILE;
}

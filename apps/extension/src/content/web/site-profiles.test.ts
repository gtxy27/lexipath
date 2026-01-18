/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi } from "vitest";

describe("site-profiles", () => {
  it("returns default profile when URL is invalid", async () => {
    vi.resetModules();
    vi.doMock("./site-profiles/index", () => ({ WEB_SITE_PROFILES: [] }));

    const { getWebSiteProfile } = await import("./site-profiles");
    const profile = getWebSiteProfile("not a url");
    expect(profile.id).toBe("default");
  });

  it("returns default profile when nothing matches", async () => {
    vi.resetModules();
    vi.doMock("./site-profiles/index", () => ({
      WEB_SITE_PROFILES: [
        {
          id: "test-profile",
          matches: (url: URL) => url.hostname === "not-example.com",
          rootSelector: "main, body",
        },
      ],
    }));

    const { getWebSiteProfile } = await import("./site-profiles");
    expect(getWebSiteProfile("https://example.com/hello").id).toBe("default");
  });

  it("returns a matching profile from the static list", async () => {
    vi.resetModules();
    vi.doMock("./site-profiles/index", () => ({
      WEB_SITE_PROFILES: [
        {
          id: "example",
          matches: (url: URL) => url.hostname === "example.com",
          rootSelector: "article, main, body",
          textSelector: "article p",
        },
      ],
    }));

    const { getWebSiteProfile } = await import("./site-profiles");
    const profile = getWebSiteProfile("https://example.com/path");
    expect(profile.id).toBe("example");
    expect(profile.textSelector).toBe("article p");
  });

  it("falls back to default if a profile throws", async () => {
    vi.resetModules();
    vi.doMock("./site-profiles/index", () => ({
      WEB_SITE_PROFILES: [
        {
          id: "throwing",
          matches: () => {
            throw new Error("boom");
          },
          rootSelector: "body",
        },
      ],
    }));

    const { getWebSiteProfile } = await import("./site-profiles");
    expect(getWebSiteProfile("https://example.com").id).toBe("default");
  });

  it("uses the first matching profile in list order", async () => {
    vi.resetModules();

    const firstMatches = vi.fn((url: URL) => url.hostname === "example.com");
    const secondMatches = vi.fn((url: URL) => url.hostname === "example.com");

    vi.doMock("./site-profiles/index", () => ({
      WEB_SITE_PROFILES: [
        {
          id: "first",
          matches: firstMatches,
          rootSelector: "article",
        },
        {
          id: "second",
          matches: secondMatches,
          rootSelector: "main",
        },
      ],
    }));

    const { getWebSiteProfile } = await import("./site-profiles");
    const profile = getWebSiteProfile("https://example.com/path");

    expect(profile.id).toBe("first");
    expect(firstMatches).toHaveBeenCalledTimes(1);
    expect(secondMatches).toHaveBeenCalledTimes(0);
  });
});

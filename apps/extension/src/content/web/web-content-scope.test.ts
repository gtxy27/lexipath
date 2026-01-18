/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi } from "vitest";

describe("web-content-scope", () => {
  it("resolves root from the selected profile", async () => {
    vi.resetModules();
    vi.doMock("./site-profiles", () => ({
      getWebSiteProfile: () => ({
        id: "test",
        matches: () => true,
        rootSelector: "#root",
      }),
    }));

    document.body.innerHTML = `
      <main>
        <article id="root"><p>Hello</p></article>
      </main>
    `;

    const { resolveWebContentScope } = await import("./web-content-scope");
    const scope = resolveWebContentScope("https://example.com");

    expect(scope.profileId).toBe("test");
    expect(scope.root.id).toBe("root");
  });

  it("excludes elements inside excluded containers", async () => {
    vi.resetModules();
    vi.doMock("./site-profiles", () => ({
      getWebSiteProfile: () => ({
        id: "test",
        matches: () => true,
        rootSelector: "main",
        textSelector: "p",
        excludeSelector: "aside",
      }),
    }));

    document.body.innerHTML = `
      <main>
        <p id="keep">Keep</p>
        <aside><p id="skip">Skip</p></aside>
      </main>
    `;

    const { resolveWebContentScope } = await import("./web-content-scope");
    const scope = resolveWebContentScope("https://example.com");
    const ids = Array.from(scope.iterateTextElements()).map((el) => el.id);

    expect(ids).toEqual(["keep"]);
  });

  it("bounds traversal by maxElements", async () => {
    vi.resetModules();
    vi.doMock("./site-profiles", () => ({
      getWebSiteProfile: () => ({
        id: "test",
        matches: () => true,
        rootSelector: "main",
        textSelector: "p",
      }),
    }));

    document.body.innerHTML = `
      <main>
        <p id="p1">1</p>
        <p id="p2">2</p>
        <p id="p3">3</p>
        <p id="p4">4</p>
      </main>
    `;

    const { resolveWebContentScope } = await import("./web-content-scope");
    const scope = resolveWebContentScope("https://example.com");
    const ids = Array.from(scope.iterateTextElements({ maxElements: 2 })).map(
      (el) => el.id,
    );

    expect(ids).toEqual(["p1", "p2"]);
  });
});


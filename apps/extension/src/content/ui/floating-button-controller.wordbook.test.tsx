/**
 * @vitest-environment happy-dom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendMessageMock, createRootMock, getLastRenderedProps, resetLastRenderedProps } =
  vi.hoisted(() => {
    let lastRenderedProps: any = null;
    return {
      sendMessageMock: vi.fn(),
      createRootMock: vi.fn(() => ({
        render: vi.fn((element: any) => {
          lastRenderedProps = element?.props ?? null;
        }),
        unmount: vi.fn(),
      })),
      getLastRenderedProps: () => lastRenderedProps,
      resetLastRenderedProps: () => {
        lastRenderedProps = null;
      },
    };
  });

vi.mock("react-dom/client", () => ({
  createRoot: createRootMock,
}));

vi.mock("webextension-polyfill", () => ({
  default: {
    i18n: { getMessage: vi.fn(() => "") },
    runtime: { openOptionsPage: vi.fn(), getURL: vi.fn((path: string) => path) },
  },
}));

vi.mock("../../shared/messages", () => ({
  sendMessage: sendMessageMock,
}));

vi.mock("../../shared/chat-anchor", () => ({
  makeWebAnchorKey: vi.fn(async () => "ak_web"),
}));

vi.mock("../../shared/tab-state", () => ({
  applyTabEnhancePausedFromStorage: vi.fn(() => {}),
  setTabEnhancePaused: vi.fn(() => {}),
  setTabShowOriginal: vi.fn(() => {}),
  ENHANCE_PAUSED_CLASS: "enhance-paused",
  SHOW_ORIGINAL_CLASS: "show-original",
}));

import { FloatingButtonController } from "./floating-button-controller";

describe("FloatingButtonController wordbook filtering and actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLastRenderedProps();

    if (!window.matchMedia) {
      (window as any).matchMedia = vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));
    }

    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }

    const wordbook = new Map<string, any>();
    sendMessageMock.mockImplementation(async (type: string, payload: any) => {
      if (type === "WORDBOOK_GET") {
        return { ok: true, value: wordbook.get(payload?.id) ?? null };
      }
      if (type === "WORDBOOK_UPSERT") {
        const entry = payload?.entry;
        if (entry?.id) wordbook.set(entry.id, entry);
        return { ok: true, value: entry };
      }
      if (type === "WORDBOOK_SET_STATE") {
        const existing = wordbook.get(payload?.id);
        if (existing) {
          wordbook.set(payload.id, { ...existing, state: payload?.state });
        }
        return { ok: true, value: wordbook.get(payload?.id) ?? null };
      }
      return { ok: true, value: null };
    });
  });

  it("filters archived/ignored entries from forgotten words when enabled", async () => {
    const controller = new FloatingButtonController({
      enabled: true,
      theme: "light",
      floatingButtonEnabled: true,
      autoEnhance: true,
      siteMode: "all",
      excludedSites: [],
      allowedSites: [],
      webShowOriginal: true,
      targetLanguage: "en",
      wordbookHideArchivedIgnoredInForgotten: true,
    } as any);

    controller.mount();

    await sendMessageMock("WORDBOOK_UPSERT", {
      entry: { id: "en:alpha", state: "archived" },
    });

    controller.updatePageContext({
      forgottenWords: [
        { word: "Alpha", familiarity: 10, encounters: 3 },
        { word: "Beta", familiarity: 10, encounters: 3 },
      ],
    });

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(getLastRenderedProps()?.forgottenWords?.map((w: any) => w.word)).toEqual(["Beta"]);
  });

  it("does not filter forgotten words when disabled", async () => {
    const controller = new FloatingButtonController({
      enabled: true,
      theme: "light",
      floatingButtonEnabled: true,
      autoEnhance: true,
      siteMode: "all",
      excludedSites: [],
      allowedSites: [],
      webShowOriginal: true,
      targetLanguage: "en",
      wordbookHideArchivedIgnoredInForgotten: false,
    } as any);

    controller.mount();

    controller.updatePageContext({
      forgottenWords: [
        { word: "Alpha", familiarity: 10, encounters: 3 },
        { word: "Beta", familiarity: 10, encounters: 3 },
      ],
    });

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(getLastRenderedProps()?.forgottenWords?.map((w: any) => w.word)).toEqual(["Alpha", "Beta"]);
  });

  it("ignore/archive does not upsert when entry exists", async () => {
    const controller = new FloatingButtonController({
      enabled: true,
      theme: "light",
      floatingButtonEnabled: true,
      autoEnhance: true,
      siteMode: "all",
      excludedSites: [],
      allowedSites: [],
      webShowOriginal: true,
      targetLanguage: "en",
      wordbookHideArchivedIgnoredInForgotten: true,
    } as any);

    controller.mount();
    controller.updatePageContext({
      forgottenWords: [{ word: "Gamma", familiarity: 10, encounters: 3 }],
    });

    await new Promise((r) => setTimeout(r, 0));

    expect(typeof getLastRenderedProps()?.onForgottenIgnore).toBe("function");
    expect(typeof getLastRenderedProps()?.onForgottenArchive).toBe("function");

    // Seed existing entry.
    await sendMessageMock("WORDBOOK_UPSERT", {
      entry: {
        id: "en:gamma",
        language: "en",
        term: "Gamma",
        normalizedTerm: "gamma",
        state: "active",
        tags: ["t1"],
        note: "n1",
        sources: [{ kind: "web", anchorKey: "ak_old", capturedAt: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
    });

    await getLastRenderedProps().onForgottenIgnore("Gamma");

    const types = sendMessageMock.mock.calls.map((call) => call[0]);
    expect(types).toContain("WORDBOOK_SET_STATE");
    // Should not clobber the entry by upserting an empty one.
    expect(types.filter((t) => t === "WORDBOOK_UPSERT").length).toBe(1);

    await getLastRenderedProps().onForgottenArchive("Gamma");
    const types2 = sendMessageMock.mock.calls.map((call) => call[0]);
    expect(types2).toContain("WORDBOOK_SET_STATE");
  });
});

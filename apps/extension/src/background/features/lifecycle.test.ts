import { beforeEach, describe, expect, it, vi } from "vitest";

const { browserMock, getSettingsMock, setSettingsMock } = vi.hoisted(() => {
  const onCommandListeners: Array<(command: string, tab?: any) => void | Promise<void>> = [];

  return {
    onCommandListeners,
    browserMock: {
      runtime: {
        onInstalled: { addListener: vi.fn() },
      },
      commands: {
        onCommand: {
          addListener: vi.fn((cb: (command: string, tab?: any) => void) => {
            onCommandListeners.push(cb);
          }),
        },
      },
      tabs: {
        query: vi.fn(async () => []),
        sendMessage: vi.fn(async () => undefined),
        create: vi.fn(async () => undefined),
      },
      sidePanel: {
        open: vi.fn(async () => undefined),
        setOptions: vi.fn(async () => undefined),
      },
    },
    getSettingsMock: vi.fn(async () => ({ floatingButtonEnabled: true, channels: [], hasCompletedOnboarding: true })),
    setSettingsMock: vi.fn(async (_patch: any) => undefined),
  };
});

vi.mock("webextension-polyfill", () => ({
  default: browserMock,
}));

vi.mock("@lexipath/core/log", () => ({
  getErrorMessage: (e: unknown) => String((e as any)?.message ?? e),
}));

vi.mock("../../shared/storage", () => ({
  getSettings: getSettingsMock,
  setSettings: setSettingsMock,
}));

import { setupLifecycleListeners } from "./lifecycle";

describe("setupLifecycleListeners (commands)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-seed listeners for each test.
    (browserMock.commands.onCommand.addListener as any).mockImplementation((cb: any) => {
      (browserMock as any).__listeners = [cb];
    });
    (browserMock as any).__listeners = [];
  });

  it("toggles floating button setting via toggle-floating-button command", async () => {
    const log = { warn: vi.fn(), debug: vi.fn() };
    setupLifecycleListeners(log);

    const cb = (browserMock as any).__listeners[0];
    expect(typeof cb).toBe("function");

    await cb("toggle-floating-button", { id: 123 });

    expect(getSettingsMock).toHaveBeenCalled();
    expect(setSettingsMock).toHaveBeenCalledWith({ floatingButtonEnabled: false });
  });

  it("sends message to active tab for toggle-original", async () => {
    const log = { warn: vi.fn(), debug: vi.fn() };
    setupLifecycleListeners(log);

    const cb = (browserMock as any).__listeners[0];
    await cb("toggle-original", { id: 7 });

    expect(browserMock.tabs.sendMessage).toHaveBeenCalledWith(7, { type: "LEXIPATH_TOGGLE_ORIGINAL_TAB" });
  });

  it("does not throw if triggered with no active tab", async () => {
    const log = { warn: vi.fn(), debug: vi.fn() };
    setupLifecycleListeners(log);

    const cb = (browserMock as any).__listeners[0];
    await expect(cb("toggle-original", undefined)).resolves.toBeUndefined();
  });

  it("best-effort toggles side panel by calling open then disabling on second press", async () => {
    const log = { warn: vi.fn(), debug: vi.fn() };
    setupLifecycleListeners(log);

    const cb = (browserMock as any).__listeners[0];

    await cb("toggle-sidebar", { id: 9 });
    expect(browserMock.sidePanel.open).toHaveBeenCalled();

    await cb("toggle-sidebar", { id: 9 });
    expect(browserMock.sidePanel.setOptions).toHaveBeenCalledWith({ tabId: 9, enabled: false });
  });
});

/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const { browserMock } = vi.hoisted(() => {
  return {
    browserMock: {
      i18n: {
        getMessage: vi.fn((key: string, substitutions?: any) => {
          if (Array.isArray(substitutions) && substitutions.length > 0) {
            return `${key}:${substitutions.join(",")}`;
          }
          if (typeof substitutions === "string") {
            return `${key}:${substitutions}`;
          }
          return key;
        }),
      },
      commands: {
        getAll: vi.fn(async () => [
          {
            name: "toggle-sidebar",
            description: "Toggle sidebar",
            shortcut: "Alt+Shift+L",
          },
          {
            name: "toggle-original",
            description: "Toggle original text",
            shortcut: "",
          },
        ]),
      },
      tabs: {
        create: vi.fn(async (_opts: any) => ({ id: 1 })),
      },
    },
  };
});

vi.mock("webextension-polyfill", () => ({
  default: browserMock,
}));

import { ShortcutsTab } from "./ShortcutsTab";

describe("ShortcutsTab", () => {
  it("renders command list with bindings", async () => {
    render(<ShortcutsTab />);

    await waitFor(() => {
      expect(browserMock.commands.getAll).toHaveBeenCalled();
    });

    expect(screen.getByText("Toggle sidebar")).toBeInTheDocument();
    expect(screen.getByText("Alt+Shift+L")).toBeInTheDocument();

    // Command with empty binding shows the fallback label.
    expect(screen.getByText("optionsShortcutsNotSet")).toBeInTheDocument();
  });

  it("opens browser shortcut config page and shows fallback when blocked", async () => {
    const user = userEvent.setup();

    vi.mocked(browserMock.tabs.create).mockRejectedValueOnce(new Error("blocked"));

    render(<ShortcutsTab />);

    const btn = await screen.findByRole("button", { name: "optionsShortcutsConfigureButton" });
    await user.click(btn);

    expect(browserMock.tabs.create).toHaveBeenCalledWith({ url: "chrome://extensions/shortcuts" });
    expect(screen.getByText("optionsShortcutsOpenBlocked:chrome://extensions/shortcuts")).toBeInTheDocument();
  });
});

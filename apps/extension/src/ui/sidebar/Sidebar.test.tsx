/**
 * @vitest-environment happy-dom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const elementProto = (globalThis.HTMLElement?.prototype ?? globalThis.Element?.prototype) as any;
if (elementProto && typeof elementProto.hasPointerCapture !== "function") {
  elementProto.hasPointerCapture = () => false;
}
if (elementProto && typeof elementProto.setPointerCapture !== "function") {
  elementProto.setPointerCapture = () => {};
}
if (elementProto && typeof elementProto.releasePointerCapture !== "function") {
  elementProto.releasePointerCapture = () => {};
}

const { browserMock, sendMessageMock } = vi.hoisted(() => {
  return {
    browserMock: {
      i18n: {
        getMessage: vi.fn((key: string) => key),
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          remove: vi.fn(async () => {}),
        },
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
    },
    sendMessageMock: vi.fn(async (type: string, payload: unknown) => {
      if (type === "GET_SETTINGS") {
        return {
          ok: true,
          value: { theme: "system" },
        };
      }
      if (type === "GET_CHAT_SESSIONS") {
        return {
          ok: true,
          value: [],
        };
      }
      if (type === "CHAT") {
        return {
          ok: true,
          value: { reply: "assistantReply", conversationId: "c1" },
        };
      }
      return { ok: true, value: null };
    }),
  };
});

vi.mock("webextension-polyfill", () => ({
  default: browserMock,
}));

vi.mock("../../shared/messages", () => ({
  sendMessage: sendMessageMock,
}));

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("renders header and empty state via i18n keys", () => {
    render(<Sidebar />);

    expect(screen.getByText("chatTitle")).toBeInTheDocument();

    expect(screen.getByText("chatEmptyTitle")).toBeInTheDocument();
    expect(screen.getByText("chatEmpty")).toBeInTheDocument();
  });

  it("sends chat message and renders assistant reply", async () => {
    const user = userEvent.setup();
    render(<Sidebar />);

    await user.type(screen.getByPlaceholderText("chatPlaceholder"), "hi{enter}");

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("CHAT", {
        message: "hi",
        conversationId: undefined,
      });
    });

    expect(await screen.findByText("assistantReply")).toBeInTheDocument();
  });
});

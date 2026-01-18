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

const { browserMock, sendMessageMock, chatStreamMock } = vi.hoisted(() => {
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
          value: [
            {
              sessionId: "kw:hello:1",
              keyword: "Hello",
              conversationIndex: 1,
              createdAt: 1,
              lastAccessedAt: 10,
              kind: "keyword",
              label: "Hello",
              anchorKey: "",
            },
            {
              sessionId: "kw:world:1",
              keyword: "WORLD",
              conversationIndex: 1,
              createdAt: 2,
              lastAccessedAt: 9,
              kind: "keyword",
              label: "WORLD",
              anchorKey: "",
            },
            {
              sessionId: "chat-3",
              keyword: "",
              conversationIndex: 0,
              createdAt: 3,
              lastAccessedAt: 8,
              kind: "general",
              label: "General",
              anchorKey: "",
            },
          ],
        };
      }
      if (type === "GET_CHAT_MESSAGES") {
        return {
          ok: true,
          value: [],
        };
      }
      return { ok: true, value: null };
    }),
    chatStreamMock: vi.fn((
      request: any,
      handlers: {
        onChunk?: (delta: string) => void;
        onThinking?: (delta: string) => void;
        onDone?: (result: { reply?: string; conversationId?: string; thinking?: string }) => void;
        onError?: (err: Error) => void;
      },
    ) => {
      // Simulate a complete stream finishing quickly.
      Promise.resolve().then(() => {
        handlers.onDone?.({
          reply: "assistantReply",
          conversationId: request?.conversationId,
        });
      });
      return { cancel: vi.fn() };
    }),
  };
});

vi.mock("webextension-polyfill", () => ({
  default: browserMock,
}));

vi.mock("../../shared/messages", () => ({
  sendMessage: sendMessageMock,
}));

vi.mock("../../shared/chat-stream", () => ({
  chatStream: chatStreamMock,
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

    // Let init finish its initial session/history load so it can't overwrite the just-sent UI.
    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("GET_CHAT_SESSIONS", {});
    });

    await user.type(screen.getByPlaceholderText("chatPlaceholder"), "hi");
    await user.click(screen.getByLabelText("chatSend"));

    await waitFor(() => {
      const chatCall = chatStreamMock.mock.calls.find((call) => call?.[0]?.message === "hi");
      expect(chatCall?.[0]).toEqual(expect.objectContaining({ message: "hi", conversationId: expect.any(String) }));
    });

    expect(await screen.findByText("assistantReply")).toBeInTheDocument();
  });

  it("sends a study-page prompt with backgroundInfo", async () => {
    const user = userEvent.setup();

    // Mock storage so init path sees a recent pending study-page message.
    (browserMock.storage.local.get as any).mockImplementation(async (key: string) => {
      if (key === "lexipath_sidebar_pending_message") {
        return {
          lexipath_sidebar_pending_message: {
            nonce: "n-study",
            text: "Study this page",
            timestamp: Date.now(),
            isAutoSend: false,
            contextInfo: {
              kind: "web",
              source: "study",
              title: "Example",
              domain: "example.com",
              url: "https://example.com/a",
              selectedText: "1. Headline one\n2. Headline two",
              beforeText: "Page description",
            },
          },
        };
      }
      return {};
    });

    render(<Sidebar />);

    // Wait for the draft prompt to appear.
    const box = await screen.findByPlaceholderText("chatPlaceholder");
    await waitFor(() => {
      expect((box as HTMLTextAreaElement).value).toBe("Study this page");
    });

    await user.click(screen.getByLabelText("chatSend"));

    await waitFor(() => {
      const chatCall = chatStreamMock.mock.calls.find((call) => call?.[0]?.message === "Study this page");
      expect(chatCall).toBeTruthy();
      const request = chatCall?.[0] as any;
      expect(request?.message).toBe("Study this page");
      expect(String(request?.backgroundInfo ?? "")).toContain("Scene: Web page");
      expect(String(request?.backgroundInfo ?? "")).toContain("Page title:");
    });
  });

  it("does not overwrite sessions list when selecting a word via pending keyword", async () => {
    // Simulate a pending message that targets a keyword session.
    // The sidebar should keep the full session list in state (so "All keywords" stays complete).
    // Keep return types loose; Sidebar only checks `.ok` and reads `.value`.
    sendMessageMock.mockImplementation(async (type: string, payload: unknown): Promise<any> => {
      if (type === "GET_SETTINGS") {
        return { ok: true, value: { theme: "system" } };
      }
      if (type === "GET_CHAT_SESSIONS") {
        // Return a full list for both all-sessions and keyword lookup.
        return {
          ok: true,
          value: [
            {
              sessionId: "kw:hello:1",
              keyword: "Hello",
              conversationIndex: 1,
              createdAt: 1,
              lastAccessedAt: 10,
              kind: "keyword",
              label: "Hello",
              anchorKey: "",
            },
            {
              sessionId: "kw:world:1",
              keyword: "WORLD",
              conversationIndex: 1,
              createdAt: 2,
              lastAccessedAt: 9,
              kind: "keyword",
              label: "WORLD",
              anchorKey: "",
            },
          ],
        };
      }
      if (type === "GET_CHAT_MESSAGES") {
        // Pretend keyword history exists.
        return {
          ok: true,
          value: [
            { id: 1, sessionId: "kw:hello:1", role: "user", content: "q", timestamp: 1 },
            { id: 2, sessionId: "kw:hello:1", role: "assistant", content: "a", timestamp: 2 },
          ],
        };
      }
      if (type === "CHAT") {
        return {
          ok: true,
          value: { reply: "assistantReply", conversationId: "kw:hello:1" },
        };
      }
      return { ok: true, value: null };
    });

    // Mock storage so init path sees a recent pending message.
    (browserMock.storage.local.get as any).mockImplementation(async (key: string) => {
      if (key === "lexipath_sidebar_pending_message") {
        return {
          lexipath_sidebar_pending_message: {
            nonce: "n1",
            text: "hi",
            keyword: "Hello",
            timestamp: Date.now(),
            isAutoSend: true,
          },
        };
      }
      return {};
    });

    render(<Sidebar />);

    // Open history panel.
    const user = userEvent.setup();
    const historyButtons = screen.getAllByTitle("chatHistory");
    await user.click(historyButtons[0]!);

    // Wait for the sessions panel to finish animating in.
    // Wait for the sessions panel to mount.
    await screen.findByText("chatHistory");

    // Switch to "Words" type.
    const kindTriggerText = await screen.findByText("chatHistoryAllTypes");
    const kindTrigger = kindTriggerText.closest("button");
    expect(kindTrigger).not.toBeNull();

    // Click can fail when children have pointer-events; dispatch via DOM click.
    kindTrigger!.click();

    const wordsOption = await screen.findByRole("option", { name: "chatHistoryKindWords" });
    (wordsOption as HTMLElement).click();

    // Open the keyword popover suggestions.
    const keywordInput = await screen.findByPlaceholderText("chatHistoryAllKeywords");
    keywordInput.click();

    // Both keywords should exist in the keyword picker.
    expect((await screen.findAllByText("Hello")).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("WORLD")).length).toBeGreaterThan(0);
  });

  it("refreshes web study context on sidebar open for web sessions", async () => {
    // Ensure previous tests' storage mocks don't force the "hasRecentPendingMessage" path.
    (browserMock.storage.local.get as any).mockImplementation(async () => ({}));

    sendMessageMock.mockImplementation(async (type: string, payload: unknown): Promise<any> => {
      if (type === "GET_SETTINGS") {
        return { ok: true, value: { theme: "system" } };
      }
      if (type === "GET_CHAT_SESSIONS") {
        return {
          ok: true,
          value: [
            {
              sessionId: "chat-web-1",
              keyword: "",
              conversationIndex: 0,
              createdAt: 1,
              lastAccessedAt: 10,
              kind: "web",
              label: "Old Page · old.example",
              anchorKey: "anchor1",
            },
            {
              sessionId: "chat-general-1",
              keyword: "",
              conversationIndex: 0,
              createdAt: 2,
              lastAccessedAt: 9,
              kind: "general",
              label: "General",
              anchorKey: "",
            },
          ],
        };
      }
      if (type === "GET_ACTIVE_WEB_STUDY_CONTEXT") {
        return {
          ok: true,
          value: {
            kind: "web",
            source: "study",
            title: "New Page",
            domain: "new.example",
            selectedText: "Hello from the current page",
          },
        };
      }
      if (type === "GET_CHAT_MESSAGES") {
        return { ok: true, value: [] };
      }
      if (type === "CHAT") {
        return { ok: true, value: { reply: "assistantReply", conversationId: "chat-web-1" } };
      }
      return { ok: true, value: null };
    });

    render(<Sidebar />);

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("GET_ACTIVE_WEB_STUDY_CONTEXT", undefined);
    });

    expect(await screen.findByText("New Page")).toBeInTheDocument();
  });
});

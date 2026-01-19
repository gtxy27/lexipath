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

const { browserMock, sendMessageMock, defaultSettings } = vi.hoisted(() => {
  const settings = {
    nativeLanguage: "zh-CN",
    targetLanguage: "en",
    proficiencyLevel: "B1",
    theme: "system",
    channels: [
      {
        channelId: 1,
        typeId: 1,
        name: "OpenAI",
        model: "",
        config: {},
        concurrencyLimit: 15,
        extra: {},
      },
    ],
    behaviorRoutes: {
      select_keywords: { kind: 1, channelId: 1, extra: {} },
      translate: { kind: 1, channelId: 1, extra: {} },
      dictionary: { kind: 1, channelId: 1, extra: {} },
      enhance_web: { kind: 1, channelId: 1, extra: {} },
      enhance_subtitle: { kind: 1, channelId: 1, extra: {} },
      chat: { kind: 1, channelId: 1, extra: {} },
    },
    enabled: true,
    autoEnhance: true,
    toolExecutionEnabled: false,
    hasCompletedOnboarding: false,
    hasSeenOptionsTour: false,
    englishCorrection: {
      enabled: false,
      triggerKey: "space",
      triggerTimes: 3,
      triggerTimeout: 500,
      autoCloseDelay: 3000,
      showUndoButton: true,
    },
    siteMode: "all",
    excludedSites: [],
    allowedSites: [],
  } as const;

  return {
    defaultSettings: settings,
    browserMock: {
      defaultSettings: settings,
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
    },
    sendMessageMock: vi.fn(async (type: string, payload: unknown) => {
      if (type === "GET_SETTINGS") return { ok: true, value: settings };
      if (type === "SET_SETTINGS") return { ok: true, value: null };
      if (type === "TEST_PROVIDER_CONNECTION") return { ok: true, value: true };
      if (type === "REQUEST_HOST_PERMISSION") return { ok: true, value: true };
      if (type === "WORDBOOK_EXPORT") {
        const format = (payload as any)?.format ?? "json";
        return {
          ok: true,
          value: {
            format,
            filename: `lexipath-wordbook.${format === "anki_csv" ? "csv" : format === "markdown" ? "md" : "json"}`,
            mime:
              format === "anki_csv"
                ? "text/csv"
                : format === "markdown"
                  ? "text/markdown"
                  : "application/json",
            content: "front,back",
          },
        };
      }
      if (type === "WORDBOOK_IMPORT") {
        return { ok: true, value: { added: 1, updated: 2, skipped: 3 } };
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

import { Options } from "./Options";

describe("Options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders channels + routing tabs after loading settings", async () => {
    render(<Options />);

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("GET_SETTINGS", undefined);
    });

    expect(screen.getAllByText("optionsTab_general")[0]).toBeTruthy();
    expect(screen.getAllByText("optionsTab_learning")[0]).toBeTruthy();
    expect(screen.getAllByText("optionsTab_channels")[0]).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getAllByRole("tab", { name: "optionsTab_channels" })[0]!);
    expect(screen.getAllByText("optionsChannelsTitle")[0]).toBeTruthy();
  });

  it("auto-shows options tour once after onboarding completion", async () => {
    sendMessageMock.mockImplementationOnce(async (type: string) => {
      if (type === "GET_SETTINGS") {
        return {
          ok: true,
          value: {
            ...(browserMock as any).defaultSettings,
            hasCompletedOnboarding: true,
            hasSeenOptionsTour: false,
          },
        } as any;
      }
      return { ok: true, value: null };
    });

    render(<Options />);

    expect(await screen.findByText((_, el) => el?.textContent === "1/9")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "optionsTourSkip" }));

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(
        "SET_SETTINGS",
        expect.objectContaining({ hasSeenOptionsTour: true }),
      );
    });
  });

  it("saves channel config and switches translate route to google", async () => {
    render(<Options />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("GET_SETTINGS", undefined);
    });

    await user.click(screen.getAllByRole("tab", { name: "optionsTab_channels" })[0]!);

    await user.type(
      screen.getAllByLabelText(/optionsProviderBaseUrlLabel/, {
        selector: "#channel-1-base-url",
      })[0]!,
      "https://api.openai.com/v1",
    );
    await user.type(
      screen.getAllByLabelText(/optionsProviderModelLabel/, {
        selector: "#channel-1-model",
      })[0]!,
      "gpt-4o-mini",
    );

    await user.click(screen.getAllByRole("tab", { name: "optionsTab_learning" })[0]!);
    await user.click(screen.getByText("optionsLearningRoutingTitle").closest("summary")!);
    await user.click(screen.getByTestId("route-kind-translate"));
    await user.click(await screen.findByText("translationProvider_google"));

    await user.click(screen.getAllByRole("button", { name: "optionsSaveButton" })[0]!);

    const setCalls = sendMessageMock.mock.calls.filter((call: any[]) => call[0] === "SET_SETTINGS");
    expect(setCalls).toHaveLength(1);

    const payload = setCalls[0]?.[1] as any;
    expect(Array.isArray(payload.channels)).toBe(true);
    expect(payload.channels[0].channelId).toBe(1);
    expect(payload.channels[0].typeId).toBe(1);
    expect(payload.channels[0].model).toBe("gpt-4o-mini");
    expect(payload.channels[0].config.baseUrl).toBe("https://api.openai.com/v1");
    expect(payload.behaviorRoutes.translate.kind).toBe(2);
  });

  it("tests Google Translate via TEST_PROVIDER_CONNECTION", async () => {
    render(<Options />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("GET_SETTINGS", undefined);
    });

    await user.click(screen.getAllByRole("tab", { name: "optionsTab_channels" })[0]!);

    await user.type(
      screen.getAllByLabelText(/optionsProviderBaseUrlLabel/, {
        selector: "#channel-1-base-url",
      })[0]!,
      "https://api.openai.com/v1",
    );
    await user.type(
      screen.getAllByLabelText(/optionsProviderModelLabel/, {
        selector: "#channel-1-model",
      })[0]!,
      "gpt-4o-mini",
    );

    await user.click(screen.getAllByRole("tab", { name: "optionsTab_learning" })[0]!);
    await user.click(screen.getByText("optionsLearningRoutingTitle").closest("summary")!);
    await user.click(screen.getByRole("button", { name: "optionsTestGoogleTranslate" }));

    const calls = sendMessageMock.mock.calls.filter((call: any[]) => call[0] === "TEST_PROVIDER_CONNECTION");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({ type: "google" });
  });

  it("saves llmContextSentences from the learning tab", async () => {
    render(<Options />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("GET_SETTINGS", undefined);
    });

    await user.click(screen.getAllByRole("tab", { name: "optionsTab_channels" })[0]!);

    await user.type(
      screen.getAllByLabelText(/optionsProviderBaseUrlLabel/, {
        selector: "#channel-1-base-url",
      })[0]!,
      "https://api.openai.com/v1",
    );
    await user.type(
      screen.getAllByLabelText(/optionsProviderModelLabel/, {
        selector: "#channel-1-model",
      })[0]!,
      "gpt-4o-mini",
    );

    await user.click(screen.getAllByRole("tab", { name: "optionsTab_learning" })[0]!);

    const toggle = await screen.findByTestId("llm-context-enabled");
    await user.click(toggle);
    await user.click(toggle);

    await user.click(screen.getByTestId("llm-context-size"));
    await user.click(await screen.findByText("optionsLlmContextSentencesLabel:3"));

    await user.click(screen.getAllByRole("button", { name: "optionsSaveButton" })[0]!);

    const setCalls = sendMessageMock.mock.calls.filter((call: any[]) => call[0] === "SET_SETTINGS");
    expect(setCalls).toHaveLength(1);

    const payload = setCalls[0]?.[1] as any;
    expect(payload.llmContextSentences).toBe(3);
  });

  it("saves wordbook settings from the learning tab", async () => {
    render(<Options />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("GET_SETTINGS", undefined);
    });

    await user.click(screen.getAllByRole("tab", { name: "optionsTab_channels" })[0]!);

    await user.type(
      screen.getAllByLabelText(/optionsProviderBaseUrlLabel/, {
        selector: "#channel-1-base-url",
      })[0]!,
      "https://api.openai.com/v1",
    );
    await user.type(
      screen.getAllByLabelText(/optionsProviderModelLabel/, {
        selector: "#channel-1-model",
      })[0]!,
      "gpt-4o-mini",
    );

    await user.click(screen.getAllByRole("tab", { name: "optionsTab_learning" })[0]!);

    const saveSnippetToggle = await screen.findByTestId("wordbook-save-snippet");
    const hideToggle = await screen.findByTestId("wordbook-hide-archived-ignored");

    await user.click(saveSnippetToggle);
    await user.click(hideToggle);

    await user.click(screen.getByTestId("wordbook-max-sources"));
    await user.click(await screen.findByText("optionsWordbookMaxSourcesLabel:3"));

    await user.click(screen.getAllByRole("button", { name: "optionsSaveButton" })[0]!);

    const setCalls = sendMessageMock.mock.calls.filter((call) => call[0] === "SET_SETTINGS");
    expect(setCalls).toHaveLength(1);

    const payload = setCalls[0]?.[1] as any;
    expect(payload.wordbook).toMatchObject({
      saveSnippetOnCapture: false,
      maxSourcesPerEntry: 3,
    });
    expect(payload.wordbookHideArchivedIgnoredInForgotten).toBe(false);
  });

  it("exports and imports wordbook from the backup section", async () => {
    render(<Options />);
    const user = userEvent.setup();

    (globalThis.URL as any).createObjectURL ??= vi.fn(() => "blob:mock");
    (globalThis.URL as any).revokeObjectURL ??= vi.fn();

    class MockFileReader {
      public onload: ((e: any) => void) | null = null;
      public result: string | null = null;
      public readAsText(file: any) {
        const promise =
          file && typeof file.text === "function" ? file.text() : Promise.resolve("");
        void promise.then((text: string) => {
          this.result = text;
          this.onload?.({ target: { result: text } });
        });
      }
    }

    (globalThis as any).FileReader = MockFileReader;

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("GET_SETTINGS", undefined);
    });

    await user.click(
      screen.getAllByRole("tab", { name: "optionsTab_channels" })[0]!,
    );

    await user.type(
      screen.getAllByLabelText(/optionsProviderBaseUrlLabel/, {
        selector: "#channel-1-base-url",
      })[0]!,
      "https://api.openai.com/v1",
    );
    await user.type(
      screen.getAllByLabelText(/optionsProviderModelLabel/, {
        selector: "#channel-1-model",
      })[0]!,
      "gpt-4o-mini",
    );

    await user.click(
      screen.getAllByRole("tab", { name: "optionsTab_general" })[0]!,
    );

    await screen.findByText("optionsGeneralBackupTitle");

    await user.click(
      screen.getByText("optionsGeneralBackupTitle").closest("summary")!,
    );

    await user.click(
      screen.getByRole("button", { name: "optionsWordbookExportButton" }),
    );

    const exportCalls = sendMessageMock.mock.calls.filter(
      (call) => call[0] === "WORDBOOK_EXPORT",
    );
    expect(exportCalls).toHaveLength(1);
    expect(exportCalls[0]?.[1]).toEqual({ format: "json" });

    const input = document.querySelector(
      'input[type="file"][accept=".json,.csv"]',
    ) as HTMLInputElement | null;
    expect(input).toBeTruthy();

    const csv = new File(["front,back"], "wordbook.csv", { type: "text/csv" });
    await user.upload(input!, csv);

    await waitFor(() => {
      const importCalls = sendMessageMock.mock.calls.filter(
        (call) => call[0] === "WORDBOOK_IMPORT",
      );
      expect(importCalls).toHaveLength(1);
    });

    const importCalls = sendMessageMock.mock.calls.filter(
      (call) => call[0] === "WORDBOOK_IMPORT",
    );
    expect(importCalls[0]?.[1]).toEqual({
      format: "anki_csv",
      data: "front,back",
      strategy: "merge",
    });
  });
});

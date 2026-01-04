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
    siteMode: "all",
    excludedSites: [],
    allowedSites: [],
  } as const;

  return {
    defaultSettings: settings,
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
    },
    sendMessageMock: vi.fn(async (type: string, payload: unknown) => {
      if (type === "GET_SETTINGS") return { ok: true, value: settings };
      if (type === "SET_SETTINGS") return { ok: true, value: null };
      if (type === "TEST_PROVIDER_CONNECTION") return { ok: true, value: true };
      if (type === "REQUEST_HOST_PERMISSION") return { ok: true, value: true };
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

    expect(screen.getByText("optionsChannelsTitle")).toBeInTheDocument();
    expect(screen.getByText("optionsRoutingTitle")).toBeInTheDocument();
  });

  it("saves channel config and switches translate route to google", async () => {
    render(<Options />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("GET_SETTINGS", undefined);
    });

    await user.type(
      screen.getByLabelText(/optionsProviderBaseUrlLabel/, {
        selector: "#channel-1-base-url",
      }),
      "https://api.openai.com/v1",
    );
    await user.type(
      screen.getByLabelText(/optionsProviderModelLabel/, {
        selector: "#channel-1-model",
      }),
      "gpt-4o-mini",
    );

    await user.click(screen.getByText("optionsRoutingTitle"));
    await user.click(screen.getByTestId("route-kind-translate"));
    await user.click(await screen.findByText("translationProvider_google"));

    await user.click(screen.getAllByRole("button", { name: "optionsSaveButton" })[0]!);

    const setCalls = sendMessageMock.mock.calls.filter((call) => call[0] === "SET_SETTINGS");
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

    await user.click(screen.getByText("optionsRoutingTitle"));
    await user.click(screen.getByRole("button", { name: "optionsTestGoogleTranslate" }));

    const calls = sendMessageMock.mock.calls.filter((call) => call[0] === "TEST_PROVIDER_CONNECTION");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toEqual({ type: "google" });
  });
});

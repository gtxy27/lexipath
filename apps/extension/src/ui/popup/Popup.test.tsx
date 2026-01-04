/**
 * @vitest-environment happy-dom
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
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
        model: "gpt-4o-mini",
        config: { baseUrl: "https://api.openai.com/v1" },
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
      explain_word: { kind: 1, channelId: 1, extra: {} },
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
      runtime: { openOptionsPage: vi.fn() },
      i18n: {
        getMessage: vi.fn((key: string) => key),
      },
    },
    sendMessageMock: vi.fn(async (type: string) => {
      if (type === "GET_SETTINGS") return { ok: true, value: settings };
      if (type === "SET_SETTINGS") return { ok: true, value: null };
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

import { Popup } from "./Popup";

describe("Popup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders i18n-driven labels after loading settings", async () => {
    render(<Popup />);

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("GET_SETTINGS", undefined);
    });

    expect(screen.getByText("extensionName")).toBeInTheDocument();
    expect(screen.getByText("popupStatusLabel")).toBeInTheDocument();
    expect(screen.getByText("popupModeSmartLearning")).toBeInTheDocument();

    expect(screen.getByText("targetLanguage")).toBeInTheDocument();
    expect(screen.getByText("languageTarget_en")).toBeInTheDocument();

    expect(screen.getByText("proficiencyLevel")).toBeInTheDocument();
    expect(screen.getByText("proficiency_B1")).toBeInTheDocument();

    expect(screen.getByText("openSettings")).toBeInTheDocument();
  });

  it("falls back to i18n placeholder for missing values", async () => {
    sendMessageMock.mockImplementationOnce(async (type: string) => {
      if (type !== "GET_SETTINGS") return { ok: true, value: null };
      const partial = { ...defaultSettings, targetLanguage: undefined, proficiencyLevel: undefined } as any;
      return { ok: true, value: partial };
    });

    render(<Popup />);

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith("GET_SETTINGS", undefined);
    });

    expect(screen.getAllByText("popupValueUnset").length).toBeGreaterThan(0);
  });
});


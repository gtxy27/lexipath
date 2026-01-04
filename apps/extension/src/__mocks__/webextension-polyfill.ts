import { vi } from "vitest";

type I18nMock = {
  getMessage: (key: string) => string;
};

export const i18n: I18nMock = {
  getMessage: vi.fn((key: string) => key) as unknown as I18nMock["getMessage"],
};

type RuntimeMock = {
  id: string;
  getURL: (path: string) => string;
  openOptionsPage: () => void;
};

export const runtime: RuntimeMock = {
  id: "test-extension-id",
  getURL: vi.fn((path: string) => path) as unknown as RuntimeMock["getURL"],
  openOptionsPage: vi.fn() as unknown as RuntimeMock["openOptionsPage"],
};

type WebExtensionPolyfillMock = {
  i18n: I18nMock;
  runtime: RuntimeMock;
};

const polyfillMock: WebExtensionPolyfillMock = {
  i18n,
  runtime,
};

export default polyfillMock;

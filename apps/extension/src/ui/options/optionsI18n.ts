import browser from "webextension-polyfill";

export function t(key: string, substitutions?: string | string[]): string {
  const message = browser.i18n.getMessage(key, substitutions as any);
  return message || key;
}


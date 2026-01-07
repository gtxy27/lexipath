import browser from "webextension-polyfill";

export function getAssetUrl(path: string): string {
  try {
    return browser.runtime.getURL(path);
  } catch {
    const origin = globalThis.location?.origin;
    return origin ? `${origin}/${path}` : path;
  }
}

export const ICON_URL = getAssetUrl("icons/icon.svg");


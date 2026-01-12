export const SHOW_ORIGINAL_CLASS = 'lexipath-show-original';
export const TAB_SHOW_ORIGINAL_KEY = 'lexipath-tab-show-original';

export const ENHANCE_PAUSED_CLASS = 'lexipath-enhance-paused';
export const TAB_ENHANCE_PAUSED_KEY = 'lexipath-tab-enhance-paused';

function readSessionFlag(key: string): boolean | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return null;
    return raw === '1';
  } catch (error: unknown) {
    void error;
    return null;
  }
}

function writeSessionFlag(key: string, value: boolean): void {
  try {
    sessionStorage.setItem(key, value ? '1' : '0');
  } catch (error: unknown) {
    void error;
  }
}

export function getTabShowOriginalOverride(): boolean | null {
  return readSessionFlag(TAB_SHOW_ORIGINAL_KEY);
}

export function getEffectiveWebShowOriginal(globalEnabled: boolean): boolean {
  const tabOverride = getTabShowOriginalOverride();
  return tabOverride ?? globalEnabled;
}

export function applyWebShowOriginal(globalEnabled: boolean): boolean {
  const enabled = getEffectiveWebShowOriginal(globalEnabled);
  document.documentElement.classList.toggle(SHOW_ORIGINAL_CLASS, enabled);
  return enabled;
}

export function setTabShowOriginal(next: boolean, globalEnabled: boolean): void {
  try {
    if (next === globalEnabled) {
      sessionStorage.removeItem(TAB_SHOW_ORIGINAL_KEY);
    } else {
      sessionStorage.setItem(TAB_SHOW_ORIGINAL_KEY, next ? '1' : '0');
    }
  } catch (error: unknown) {
    void error;
  }
  document.documentElement.classList.toggle(SHOW_ORIGINAL_CLASS, next);
}

export function toggleTabShowOriginal(globalEnabled: boolean): boolean {
  const current = getEffectiveWebShowOriginal(globalEnabled);
  const next = !current;
  setTabShowOriginal(next, globalEnabled);
  return next;
}

export function isEnhancePausedNow(): boolean {
  return document.documentElement.classList.contains(ENHANCE_PAUSED_CLASS);
}

export function applyTabEnhancePausedFromStorage(): boolean {
  const paused = readSessionFlag(TAB_ENHANCE_PAUSED_KEY) ?? false;
  document.documentElement.classList.toggle(ENHANCE_PAUSED_CLASS, paused);
  return paused;
}

export function setTabEnhancePaused(next: boolean): void {
  writeSessionFlag(TAB_ENHANCE_PAUSED_KEY, next);
  document.documentElement.classList.toggle(ENHANCE_PAUSED_CLASS, next);
}


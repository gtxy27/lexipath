import { useEffect } from "react";
import type { Theme } from "@lexipath/core";

function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function setDocumentDarkClass(enabled: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", enabled);
  document.body?.classList?.toggle?.("dark", enabled);
}

export function applyThemeToDocument(theme: Theme): void {
  const prefersDark = getSystemPrefersDark();
  const isDark = theme === "dark" || (theme === "system" && prefersDark);
  setDocumentDarkClass(isDark);
}

export function useApplyTheme(theme: Theme | null | undefined): void {
  useEffect(() => {
    const resolvedTheme: Theme = theme ?? "system";
    const media =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;

    const apply = () => applyThemeToDocument(resolvedTheme);

    apply();

    if (resolvedTheme !== "system" || !media) return undefined;

    const onChange = () => apply();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }

    // Legacy Safari + older browsers.
    if (typeof (media as any).addListener === "function") {
      (media as any).addListener(onChange);
      return () => (media as any).removeListener(onChange);
    }

    return undefined;
  }, [theme]);
}

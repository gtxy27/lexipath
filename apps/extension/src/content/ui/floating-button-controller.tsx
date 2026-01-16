import { createRoot, Root } from "react-dom/client";
import React from "react";
import browser from "webextension-polyfill";
import { FloatingButton } from "./floating-button";
import { Settings } from "@lexipath/core";
import { isUrlInSiteList } from "@lexipath/core/qualify";
import { sendMessage } from "../../shared/messages";
import {
  applyTabEnhancePausedFromStorage,
  ENHANCE_PAUSED_CLASS,
  setTabEnhancePaused,
  setTabShowOriginal,
  SHOW_ORIGINAL_CLASS,
} from "../../shared/tab-state";
import { FLOATING_BUTTON_CONTAINER_ID, FLOATING_HIDE_ONCE_KEY, HAS_ENHANCED_ONCE_KEY } from "./floating-button-constants";

type EnhanceSiteMode = "manual" | "auto_blacklist" | "auto_whitelist";
type SiteRuleStatus = "enabled" | "disabled" | "not_in_whitelist";
type PageContext = {
  forgottenWords: Array<{ word: string; familiarity: number; encounters: number }>;
  translatedCount?: number;
  seenCount?: number;
  webEnhanceMode?: "i_plus_1" | "light" | "full";
  pageEligible?: boolean;
  pageLanguage?: string;
};

// Theme variables should be owned by the extension, not inherited from the page.
// These values mirror `apps/extension/src/ui/styles.css` (:root + .dark).
const LIGHT_THEME_VARS: Record<string, string> = {
  "--background": "0 0% 100%",
  "--foreground": "222.2 84% 4.9%",
  "--card": "0 0% 100%",
  "--card-foreground": "222.2 84% 4.9%",
  "--popover": "0 0% 100%",
  "--popover-foreground": "222.2 84% 4.9%",
  "--primary": "221.2 83.2% 53.3%",
  "--primary-foreground": "210 40% 98%",
  "--secondary": "210 40% 96.1%",
  "--secondary-foreground": "222.2 47.4% 11.2%",
  "--muted": "210 40% 96.1%",
  "--muted-foreground": "215.4 16.3% 46.9%",
  "--accent": "210 40% 96.1%",
  "--accent-foreground": "222.2 47.4% 11.2%",
  "--destructive": "0 84.2% 60.2%",
  "--destructive-foreground": "210 40% 98%",
  "--border": "214.3 31.8% 91.4%",
  "--input": "214.3 31.8% 91.4%",
  "--ring": "221.2 83.2% 53.3%",
  "--radius": "0.5rem",
};

const DARK_THEME_VARS: Record<string, string> = {
  "--background": "231.4 21.2% 7%",
  "--foreground": "210 40% 98%",
  "--card": "236.2 24% 12%",
  "--card-foreground": "210 40% 98%",
  "--popover": "236.2 24% 13%",
  "--popover-foreground": "210 40% 98%",
  "--primary": "217.2 91.2% 59.8%",
  "--primary-foreground": "222.2 47.4% 11.2%",
  "--secondary": "233.3 14.8% 13.5%",
  "--secondary-foreground": "210 40% 98%",
  "--muted": "233.3 14.8% 13.5%",
  "--muted-foreground": "215 20.2% 70%",
  "--accent": "233.3 14.8% 13.5%",
  "--accent-foreground": "210 40% 98%",
  "--destructive": "0 62.8% 30.6%",
  "--destructive-foreground": "210 40% 98%",
  "--border": "233.3 11% 22%",
  "--input": "233.3 11% 22%",
  "--ring": "224.3 76.3% 48%",
  "--radius": "0.5rem",
};

export class FloatingButtonController {
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private root: Root | null = null;
  private rootEl: HTMLDivElement | null = null;
  private settings: Settings | null = null;
  private onRunWebEnhanceOnce: (() => void | Promise<void>) | null = null;
  private onRunWebRewriteOnce: (() => void | Promise<void>) | null = null;
  private pageContext: PageContext = { forgottenWords: [] };
  private prefersDarkMql: MediaQueryList | null = null;
  private prefersDarkHandler: (() => void) | null = null;

  constructor(
    settings: Settings | null,
    options?: {
      onRunWebEnhanceOnce?: () => void | Promise<void>;
      onRunWebRewriteOnce?: () => void | Promise<void>;
    },
  ) {
    this.settings = settings;
    this.onRunWebEnhanceOnce = options?.onRunWebEnhanceOnce ?? null;
    this.onRunWebRewriteOnce = options?.onRunWebRewriteOnce ?? null;
  }

  mount() {
    const shouldShow = this.shouldShowFloatingButton();
    if (!shouldShow) return;
    if (this.container) return;

    this.container = document.createElement("div");
    this.container.id = FLOATING_BUTTON_CONTAINER_ID;
    // Keep the host element non-invasive: no size, no blocking clicks.
    // All visible UI is positioned via `position: fixed` inside the ShadowRoot.
    this.container.style.cssText =
      "position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";

    // Use Shadow DOM for style isolation
    this.shadow = this.container.attachShadow({ mode: "open" });

    // Load the extension's Tailwind/theme CSS inside the ShadowRoot so shadcn/ui classes work.
    // We run two Vite builds (UI + content) into the same `dist/*` folder, so Rollup may deconflict
    // same-named CSS assets as `theme.css`, `theme2.css`, etc. Load the common candidates, but don't
    // fail if an extra CSS file isn't present.
    for (const href of ["assets/theme.css", "assets/theme2.css"]) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = browser.runtime.getURL(href);
      link.addEventListener("error", () => {
        try {
          link.remove();
        } catch {
          // ignore
        }
      });
      this.shadow.appendChild(link);
    }

    // Inject styles from the main document (lexipath-styles) into shadow DOM
    const mainStyle = document.getElementById("lexipath-styles");
    if (mainStyle) {
      const styleEl = document.createElement("style");
      styleEl.textContent = mainStyle.textContent;
      this.shadow.appendChild(styleEl);
    }

    const rootEl = document.createElement("div");
    rootEl.style.cssText = "pointer-events: auto;";
    rootEl.className = "lexipath-floating-root text-foreground font-sans antialiased";
    this.shadow.appendChild(rootEl);
    this.rootEl = rootEl;
    this.setupThemeSync();
    this.applyThemeToRoot();

    this.root = createRoot(rootEl);
    this.render();

    applyTabEnhancePausedFromStorage();

    document.documentElement.appendChild(this.container);
  }

  updatePageContext(next: Partial<PageContext>) {
    this.pageContext = { ...this.pageContext, ...next };
    this.render();
  }

  updateSettings(settings: Settings) {
    this.settings = settings;
    const shouldShow = this.shouldShowFloatingButton(settings);
    if (!shouldShow) {
      this.unmount();
      return;
    }
    if (!this.container) {
      this.mount();
      return;
    }
    this.applyThemeToRoot();
    this.render();
  }

  private isDarkTheme(): boolean {
    const theme = this.settings?.theme ?? "system";
    if (theme === "dark") return true;
    if (theme === "light") return false;
    return Boolean(window.matchMedia?.("(prefers-color-scheme: dark)")?.matches);
  }

  private applyThemeToRoot(): void {
    const rootEl = this.rootEl;
    if (!rootEl) return;

    const isDark = this.isDarkTheme();
    rootEl.classList.toggle("dark", isDark);
    rootEl.style.colorScheme = isDark ? "dark" : "light";

    const vars = isDark ? DARK_THEME_VARS : LIGHT_THEME_VARS;
    for (const [key, value] of Object.entries(vars)) {
      rootEl.style.setProperty(key, value);
    }
  }

  private setupThemeSync(): void {
    if (this.prefersDarkMql || this.prefersDarkHandler) return;
    if (!window.matchMedia) return;

    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const theme = this.settings?.theme ?? "system";
      if (theme !== "system") return;
      this.applyThemeToRoot();
      this.render();
    };

    this.prefersDarkMql = mql;
    this.prefersDarkHandler = handler;

    try {
      mql.addEventListener("change", handler);
    } catch (error: unknown) {
      void error;
      (mql as any).addListener?.(handler);
    }
  }

  private teardownThemeSync(): void {
    const mql = this.prefersDarkMql;
    const handler = this.prefersDarkHandler;
    if (!mql || !handler) return;

    try {
      mql.removeEventListener("change", handler);
    } catch (error: unknown) {
      void error;
      (mql as any).removeListener?.(handler);
    } finally {
      this.prefersDarkMql = null;
      this.prefersDarkHandler = null;
    }
  }

  private shouldShowFloatingButton(settingsOverride?: Settings | null): boolean {
    const settings = settingsOverride ?? this.settings;
    const enabled = settings?.floatingButtonEnabled ?? true;
    if (!enabled) return false;

    try {
      const hiddenOnce = sessionStorage.getItem(FLOATING_HIDE_ONCE_KEY) === "1";
      if (hiddenOnce) return false;
    } catch (error: unknown) {
      void error;
    }

    return true;
  }

  private getEnhanceSiteMode(settings: Settings): EnhanceSiteMode {
    if (!settings.autoEnhance) return "manual";
    return settings.siteMode === "whitelist" ? "auto_whitelist" : "auto_blacklist";
  }

  private getSiteRuleStatus(settings: Settings): { status: SiteRuleStatus; matchedRule?: string } {
    const mode = this.getEnhanceSiteMode(settings);
    const url = window.location.href;

    if (mode === "auto_blacklist") {
      const matched = isUrlInSiteList({ url, sites: settings.excludedSites ?? [] });
      if (!matched.matched) return { status: "enabled" };
      return matched.matchedRule ? { status: "disabled", matchedRule: matched.matchedRule } : { status: "disabled" };
    }

    if (mode === "auto_whitelist") {
      const matched = isUrlInSiteList({ url, sites: settings.allowedSites ?? [] });
      if (!matched.matched) return { status: "not_in_whitelist" };
      return matched.matchedRule ? { status: "enabled", matchedRule: matched.matchedRule } : { status: "enabled" };
    }

    return { status: "enabled" };
  }

  private render() {
    if (!this.root) return;

    this.applyThemeToRoot();

    const settings = this.settings;
    const siteMode = settings ? this.getEnhanceSiteMode(settings) : "manual";
    const siteRule = settings ? this.getSiteRuleStatus(settings) : { status: "enabled" as const };
    const currentHost = window.location.hostname;
    const tabShowOriginal = document.documentElement.classList.contains(SHOW_ORIGINAL_CLASS);
    const tabEnhancePaused = document.documentElement.classList.contains(ENHANCE_PAUSED_CLASS);
    const hasEnhancedOnce = (() => {
      try {
        return sessionStorage.getItem(HAS_ENHANCED_ONCE_KEY) === "1";
      } catch (error: unknown) {
        void error;
        return false;
      }
    })();
    const hasEnhancedMarkup = Boolean(
      hasEnhancedOnce || document.querySelector(".lexipath-word, .lexipath-paragraph-enhanced"),
    );

    this.root.render(
      <FloatingButton
        enabled={settings?.enabled ?? true}
        enhanceSiteMode={siteMode}
        siteRuleStatus={siteRule.status}
        {...(siteRule.matchedRule ? { siteRuleMatchedRule: siteRule.matchedRule } : {})}
        currentHost={currentHost}
        tabShowOriginal={tabShowOriginal}
        enhancePaused={tabEnhancePaused}
        hasEnhancedMarkup={hasEnhancedMarkup}
        forgottenWords={this.pageContext.forgottenWords}
        translatedCount={this.pageContext.translatedCount ?? 0}
        seenCount={this.pageContext.seenCount ?? 0}
        webEnhanceMode={this.pageContext.webEnhanceMode ?? "i_plus_1"}
        pageEligible={this.pageContext.pageEligible ?? true}
        {...(this.pageContext.pageLanguage ? { pageLanguage: this.pageContext.pageLanguage } : {})}
        onToggleCurrentSiteRule={() => {
          if (!settings) return;
          const url = window.location.href;
          const hostRule = window.location.hostname;
          const mode = this.getEnhanceSiteMode(settings);

          if (mode === "auto_blacklist") {
            const matched = isUrlInSiteList({ url, sites: settings.excludedSites ?? [] });
            const nextExcluded = matched.matched
              ? (settings.excludedSites ?? []).filter((rule) => rule !== matched.matchedRule)
              : Array.from(new Set([...(settings.excludedSites ?? []), hostRule]));
            sendMessage("SET_SETTINGS", { excludedSites: nextExcluded });
          }

          if (mode === "auto_whitelist") {
            const matched = isUrlInSiteList({ url, sites: settings.allowedSites ?? [] });
            const nextAllowed = matched.matched
              ? (settings.allowedSites ?? []).filter((rule) => rule !== matched.matchedRule)
              : Array.from(new Set([...(settings.allowedSites ?? []), hostRule]));
            sendMessage("SET_SETTINGS", { allowedSites: nextAllowed });
          }
        }}
        onRunEnhanceOnce={async () => {
          try {
            await this.onRunWebEnhanceOnce?.();
          } finally {
            this.render();
          }
        }}
        onRunRewriteOnce={async () => {
          try {
            await this.onRunWebRewriteOnce?.();
          } finally {
            this.render();
          }
        }}
        onSetTabShowOriginal={(showOriginal) => {
          setTabShowOriginal(showOriginal, Boolean(this.settings?.webShowOriginal));
          this.render();
        }}
        onSetTabEnhancePaused={(paused) => {
          setTabEnhancePaused(paused);
          this.render();
        }}
        onOpenOptions={() => {
          browser.runtime.openOptionsPage();
        }}
        onOpenSidebar={() => {
          sendMessage("OPEN_SIDEBAR", { isAutoSend: false });
        }}
        onHideOnce={() => {
          try {
            sessionStorage.setItem(FLOATING_HIDE_ONCE_KEY, "1");
          } catch (error: unknown) {
            void error;
          }
          this.unmount();
        }}
      />
    );
  }

  unmount() {
    this.teardownThemeSync();
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.shadow = null;
    this.rootEl = null;
  }
}

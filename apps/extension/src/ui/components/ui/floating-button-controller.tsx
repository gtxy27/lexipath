import { createRoot, Root } from "react-dom/client";
import React from "react";
import browser from "webextension-polyfill";
import { FloatingButton } from "./floating-button";
import { Settings } from "@lexipath/core";
import { isUrlInSiteList } from "@lexipath/core/qualify";
import { sendMessage } from "../../../shared/messages";

type EnhanceSiteMode = "manual" | "auto_blacklist" | "auto_whitelist";
type SiteRuleStatus = "enabled" | "disabled" | "not_in_whitelist";
type PageContext = {
  forgottenWords: Array<{ word: string; familiarity: number; encounters: number }>;
};

const SHOW_ORIGINAL_CLASS = "lexipath-show-original";
const TAB_SHOW_ORIGINAL_KEY = "lexipath-tab-show-original";
const FLOATING_HIDE_ONCE_KEY = "lexipath-floating-hide-once";

export class FloatingButtonController {
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private root: Root | null = null;
  private settings: Settings | null = null;
  private onRunWebEnhanceOnce: (() => void | Promise<void>) | null = null;
  private pageContext: PageContext = { forgottenWords: [] };

  constructor(
    settings: Settings | null,
    options?: { onRunWebEnhanceOnce?: () => void | Promise<void> },
  ) {
    this.settings = settings;
    this.onRunWebEnhanceOnce = options?.onRunWebEnhanceOnce ?? null;
  }

  mount() {
    const shouldShow = this.shouldShowFloatingButton();
    if (!shouldShow) return;
    if (this.container) return;

    this.container = document.createElement("div");
    this.container.id = "lexipath-floating-button-container";
    // Keep the host element non-invasive: no size, no blocking clicks.
    // All visible UI is positioned via `position: fixed` inside the ShadowRoot.
    this.container.style.cssText =
      "position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";

    // Use Shadow DOM for style isolation
    this.shadow = this.container.attachShadow({ mode: "open" });

    // Load the extension's Tailwind/theme CSS inside the ShadowRoot so shadcn/ui classes work.
    const themeLink = document.createElement("link");
    themeLink.rel = "stylesheet";
    themeLink.href = browser.runtime.getURL("assets/theme.css");
    this.shadow.appendChild(themeLink);

    // Inject styles from the main document (lexipath-styles) into shadow DOM
    const mainStyle = document.getElementById("lexipath-styles");
    if (mainStyle) {
      const styleEl = document.createElement("style");
      styleEl.textContent = mainStyle.textContent;
      this.shadow.appendChild(styleEl);
    }

    const rootEl = document.createElement("div");
    rootEl.style.cssText = "pointer-events: auto;";
    this.shadow.appendChild(rootEl);

    this.root = createRoot(rootEl);
    this.render();

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
    this.render();
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

  private applyOriginalClass(settings: Settings): void {
    const globalEnabled = Boolean(settings.webShowOriginal);
    const tabOverride = (() => {
      try {
        const raw = sessionStorage.getItem(TAB_SHOW_ORIGINAL_KEY);
        if (raw === null) return null;
        return raw === "1";
      } catch (error: unknown) {
        void error;
        return null;
      }
    })();
    const enabled = tabOverride ?? globalEnabled;
    document.documentElement.classList.toggle(SHOW_ORIGINAL_CLASS, enabled);
  }

  private toggleTabOriginal(): void {
    const current = document.documentElement.classList.contains(SHOW_ORIGINAL_CLASS);
    const next = !current;
    try {
      sessionStorage.setItem(TAB_SHOW_ORIGINAL_KEY, next ? "1" : "0");
    } catch (error: unknown) {
      void error;
    }
    document.documentElement.classList.toggle(SHOW_ORIGINAL_CLASS, next);
  }

  private render() {
    if (!this.root) return;

    const settings = this.settings;
    const siteMode = settings ? this.getEnhanceSiteMode(settings) : "manual";
    const siteRule = settings ? this.getSiteRuleStatus(settings) : { status: "enabled" as const };
    const currentHost = window.location.hostname;

    this.root.render(
      <FloatingButton
        enabled={settings?.enabled ?? true}
        webEnhanceMode={settings?.webEnhanceMode ?? "i_plus_1"}
        enhanceSiteMode={siteMode}
        siteRuleStatus={siteRule.status}
        {...(siteRule.matchedRule ? { siteRuleMatchedRule: siteRule.matchedRule } : {})}
        currentHost={currentHost}
        globalShowOriginal={Boolean(settings?.webShowOriginal)}
        forgottenWords={this.pageContext.forgottenWords}
        onToggleEnabled={(enabled) => {
          sendMessage("SET_SETTINGS", { enabled });
        }}
        onCycleWebEnhanceMode={() => {
          if (!settings) return;
          const order: Array<Settings["webEnhanceMode"]> = ["light", "i_plus_1", "full"];
          const idx = Math.max(0, order.indexOf(settings.webEnhanceMode ?? "i_plus_1"));
          const next = order[(idx + 1) % order.length];
          sendMessage("SET_SETTINGS", { webEnhanceMode: next });
        }}
        onCycleEnhanceSiteMode={() => {
          if (!settings) return;
          const current = this.getEnhanceSiteMode(settings);
          const next: EnhanceSiteMode =
            current === "manual" ? "auto_blacklist" : current === "auto_blacklist" ? "auto_whitelist" : "manual";

          if (next === "manual") {
            sendMessage("SET_SETTINGS", { autoEnhance: false, siteMode: "all" });
          } else if (next === "auto_blacklist") {
            sendMessage("SET_SETTINGS", { autoEnhance: true, siteMode: "all" });
          } else {
            sendMessage("SET_SETTINGS", { autoEnhance: true, siteMode: "whitelist" });
          }
        }}
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
        onRunEnhanceOnce={() => this.onRunWebEnhanceOnce?.()}
        onToggleOriginalTab={() => {
          this.toggleTabOriginal();
        }}
        onToggleOriginalGlobal={() => {
          if (!settings) return;
          const next = !Boolean(settings.webShowOriginal);
          sendMessage("SET_SETTINGS", { webShowOriginal: next }).then(() => {
            this.applyOriginalClass({ ...settings, webShowOriginal: next });
          });
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
        onHideFloatingButton={() => {
          sendMessage("SET_SETTINGS", { floatingButtonEnabled: false });
        }}
      />
    );
  }

  unmount() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.shadow = null;
  }
}

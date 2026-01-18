import { createRoot, Root } from "react-dom/client";
import React from "react";
import browser from "webextension-polyfill";
import { FloatingButton } from "./floating-button";

// Ensure the controller stays in sync with the FloatingButton props.
import type { FloatingButtonProps } from "./floating-button";
import type { Settings } from "@lexipath/core";
import { makeWordbookEntryId, normalizeWordbookLanguage, normalizeWordbookTerm } from "@lexipath/core";
import { isUrlInSiteList } from "@lexipath/core/qualify";
import { sendMessage } from "../../shared/messages";
import { buildStudyContext } from "../web/study-context";
import { makeWebAnchorKey } from "../../shared/chat-anchor";



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
  "--success": "142.1 76.2% 36.3%",
  "--success-foreground": "355.7 100% 97.3%",
  "--warning": "38 92% 50%",
  "--warning-foreground": "48 96% 89%",
  "--info": "199 89% 48%",
  "--info-foreground": "0 0% 100%",
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
  "--success": "142.1 70.6% 45.3%",
  "--success-foreground": "144.9 80.4% 10%",
  "--warning": "48 96% 89%",
  "--warning-foreground": "38 92% 50%",
  "--info": "199 89% 60%",
  "--info-foreground": "0 0% 100%",
  "--border": "233.3 11% 28%",
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
  private rawForgottenWords: PageContext["forgottenWords"] = [];
  private forgottenFilterToken = 0;
  private forgottenWordbookStateCache = new Map<string, "active" | "archived" | "ignored" | null>();
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
    const hasForgotten = Array.isArray(next.forgottenWords);
    if (hasForgotten) {
      this.rawForgottenWords = next.forgottenWords ?? [];
    }

    const displayForgotten = this.computeDisplayForgottenWords();
    this.pageContext = {
      ...this.pageContext,
      ...next,
      ...(hasForgotten ? { forgottenWords: displayForgotten } : {}),
    };

    if (hasForgotten) {
      void this.refreshForgottenWordbookStates();
    }

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
    void this.refreshForgottenWordbookStates();
    this.render();
  }

  private shouldHideArchivedIgnoredInForgotten(): boolean {
    return this.settings?.wordbookHideArchivedIgnoredInForgotten ?? true;
  }

  private resolveWordbookLanguage(): string {
    return normalizeWordbookLanguage(
      this.settings?.targetLanguage ?? this.pageContext.pageLanguage ?? "en",
    );
  }

  private computeDisplayForgottenWords(): PageContext["forgottenWords"] {
    const raw = this.rawForgottenWords ?? [];
    if (!this.shouldHideArchivedIgnoredInForgotten()) return raw;

    const language = this.resolveWordbookLanguage();
    return raw.filter(({ word }) => {
      const id = makeWordbookEntryId(language as any, word);
      const state = this.forgottenWordbookStateCache.get(id);
      return state !== "archived" && state !== "ignored";
    });
  }

  private mergeWordbookSources(existing: any[], incoming: any): any[] {
    const out: any[] = [];
    const seen = new Set<string>();

    const add = (src: any) => {
      if (!src) return;
      const kind = String(src.kind ?? "");
      const anchorKey = String(src.anchorKey ?? "");
      if (!kind || !anchorKey) return;
      const key = `${kind}\u0000${anchorKey}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(src);
    };

    add(incoming);
    for (const src of Array.isArray(existing) ? existing : []) add(src);

    out.sort((a, b) => (Number(b.capturedAt ?? 0) || 0) - (Number(a.capturedAt ?? 0) || 0));
    return out;
  }

  private async refreshForgottenWordbookStates(): Promise<void> {
    if (!this.shouldHideArchivedIgnoredInForgotten()) {
      this.pageContext = {
        ...this.pageContext,
        forgottenWords: this.rawForgottenWords ?? [],
      };
      this.render();
      return;
    }

    const language = this.resolveWordbookLanguage();
    const ids = (this.rawForgottenWords ?? [])
      .map(({ word }) => makeWordbookEntryId(language as any, word))
      .filter(Boolean);

    const uniqueIds = Array.from(new Set(ids));
    const toFetch = uniqueIds.filter((id) => !this.forgottenWordbookStateCache.has(id));

    const token = ++this.forgottenFilterToken;

    await Promise.all(
      toFetch.map(async (id) => {
        try {
          const resp = await sendMessage("WORDBOOK_GET", { id } as any);
          if (!resp.ok) {
            this.forgottenWordbookStateCache.set(id, null);
            return;
          }
          const entry = resp.value as any;
          const state = entry?.state ?? null;
          this.forgottenWordbookStateCache.set(id, state);
        } catch {
          this.forgottenWordbookStateCache.set(id, null);
        }
      }),
    );

    if (token !== this.forgottenFilterToken) return;

    this.pageContext = {
      ...this.pageContext,
      forgottenWords: this.computeDisplayForgottenWords(),
    };
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

    const props: FloatingButtonProps = {
      enabled: settings?.enabled ?? true,
      enhanceSiteMode: siteMode,
      siteRuleStatus: siteRule.status,
      ...(siteRule.matchedRule ? { siteRuleMatchedRule: siteRule.matchedRule } : {}),
      currentHost,
      tabShowOriginal,
      enhancePaused: tabEnhancePaused,
      hasEnhancedMarkup,
      forgottenWords: this.pageContext.forgottenWords,
      translatedCount: this.pageContext.translatedCount ?? 0,
      seenCount: this.pageContext.seenCount ?? 0,
      webEnhanceMode: this.pageContext.webEnhanceMode ?? "i_plus_1",
      pageEligible: this.pageContext.pageEligible ?? true,
      ...(this.pageContext.pageLanguage ? { pageLanguage: this.pageContext.pageLanguage } : {}),
      onToggleCurrentSiteRule: async () => {
        const hostRule = currentHost;
        const url = window.location.href;
        if (!settings) return;
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
      },
      onRunEnhanceOnce: async () => {
        try {
          await this.onRunWebEnhanceOnce?.();
        } finally {
          this.render();
        }
      },
      onRunRewriteOnce: async () => {
        try {
          await this.onRunWebRewriteOnce?.();
        } finally {
          this.render();
        }
      },
      onSetTabShowOriginal: (showOriginal) => {
        setTabShowOriginal(showOriginal, Boolean(this.settings?.webShowOriginal));
        this.render();
      },
      onSetTabEnhancePaused: (paused) => {
        setTabEnhancePaused(paused);
        this.render();
      },
      onOpenOptions: () => {
        browser.runtime.openOptionsPage();
      },
       onOpenSidebar: () => {
         sendMessage("OPEN_SIDEBAR", { isAutoSend: false });
       },
        onOpenWordbook: () => {
          sendMessage("OPEN_SIDEBAR", {
            isAutoSend: false,
            ui: { panel: "wordbook" },
          } as any);
        },

       onForgottenSave: async (word) => {
         const language = this.resolveWordbookLanguage();
         const url = window.location.href;
         const anchorKey = await makeWebAnchorKey(url);

         const snippet = (() => {
           const s = String(word ?? "").trim();
           return s.length > 120 ? s.slice(0, 120) : s;
         })();

         const normalizedTerm = normalizeWordbookTerm(word);
         const id = makeWordbookEntryId(language as any, normalizedTerm);
         if (!normalizedTerm) return;

         const now = Date.now();

         const existing = await (async () => {
           try {
             const resp = await sendMessage("WORDBOOK_GET", { id } as any);
             return resp.ok ? (resp.value as any) : null;
           } catch {
             return null;
           }
         })();

         const nextSources = anchorKey
           ? this.mergeWordbookSources(existing?.sources, {
               kind: "web",
               anchorKey,
               capturedAt: now,
               ...(snippet ? { snippet } : {}),
               domain: window.location.hostname,
               title: document.title,
             })
           : Array.isArray(existing?.sources)
             ? existing.sources
             : [];

         const entry = {
           id,
           language,
           term: (existing?.term ?? String(word ?? "").trim()) as string,
           normalizedTerm,
           state: "active",
           tags: Array.isArray(existing?.tags) ? existing.tags : [],
           note: typeof existing?.note === "string" ? existing.note : "",
           sources: nextSources,
           createdAt: typeof existing?.createdAt === "number" ? existing.createdAt : now,
           updatedAt: now,
         };

         await sendMessage("WORDBOOK_UPSERT", { entry } as any);
         this.forgottenWordbookStateCache.set(id, "active");
         void this.refreshForgottenWordbookStates();
       },
       onForgottenIgnore: async (word) => {
         const language = this.resolveWordbookLanguage();
         const normalizedTerm = normalizeWordbookTerm(word);
         const id = makeWordbookEntryId(language as any, normalizedTerm);
         if (!normalizedTerm) return;

         const existing = await sendMessage("WORDBOOK_GET", { id } as any);
         if (!existing.ok || !existing.value) {
           const now = Date.now();
           await sendMessage("WORDBOOK_UPSERT", {
             entry: {
               id,
               language,
               term: String(word ?? "").trim(),
               normalizedTerm,
               state: "ignored",
               tags: [],
               note: "",
               sources: [],
               createdAt: now,
               updatedAt: now,
             },
           } as any);
         } else {
           await sendMessage("WORDBOOK_SET_STATE", { id, state: "ignored" } as any);
         }
         this.forgottenWordbookStateCache.set(id, "ignored");
         void this.refreshForgottenWordbookStates();
       },
       onForgottenArchive: async (word) => {
         const language = this.resolveWordbookLanguage();
         const normalizedTerm = normalizeWordbookTerm(word);
         const id = makeWordbookEntryId(language as any, normalizedTerm);
         if (!normalizedTerm) return;

         const existing = await sendMessage("WORDBOOK_GET", { id } as any);
         if (!existing.ok || !existing.value) {
           const now = Date.now();
           await sendMessage("WORDBOOK_UPSERT", {
             entry: {
               id,
               language,
               term: String(word ?? "").trim(),
               normalizedTerm,
               state: "archived",
               tags: [],
               note: "",
               sources: [],
               createdAt: now,
               updatedAt: now,
             },
           } as any);
         } else {
           await sendMessage("WORDBOOK_SET_STATE", { id, state: "archived" } as any);
         }
         this.forgottenWordbookStateCache.set(id, "archived");
         void this.refreshForgottenWordbookStates();
       },

      onStudyPage: () => {
        const url = window.location.href;
        const prompt = browser.i18n.getMessage("chatStudyPagePrompt") || "Study this page";

        const context = buildStudyContext(url, { preloadScreens: 2 });

        sendMessage("OPEN_SIDEBAR", {
          initialMessage: prompt,
          isAutoSend: false,
          contextInfo: {
            kind: "web",
            source: "study",
            title: document.title,
            domain: window.location.hostname,
            url,
            ...(context.beforeText ? { beforeText: context.beforeText } : {}),
            ...(context.selectedText ? { selectedText: context.selectedText } : {}),
          },
        });
      },
      onHideOnce: () => {
        try {
          sessionStorage.setItem(FLOATING_HIDE_ONCE_KEY, "1");
        } catch (error: unknown) {
          void error;
        }
        this.unmount();
      },
    };

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
        {...(props.onOpenWordbook ? { onOpenWordbook: props.onOpenWordbook } : {})}
        {...(props.onForgottenSave ? { onForgottenSave: props.onForgottenSave } : {})}
        {...(props.onForgottenIgnore ? { onForgottenIgnore: props.onForgottenIgnore } : {})}
        {...(props.onForgottenArchive ? { onForgottenArchive: props.onForgottenArchive } : {})}
        onStudyPage={() => {
          const url = window.location.href;
          const prompt = browser.i18n.getMessage("chatStudyPagePrompt") || "Study this page";
          const context = buildStudyContext(url, { preloadScreens: 2 });

          sendMessage("OPEN_SIDEBAR", {
            initialMessage: prompt,
            isAutoSend: false,
            contextInfo: {
              kind: "web",
              source: "study",
              title: document.title,
              domain: window.location.hostname,
              url,
              ...(context.beforeText ? { beforeText: context.beforeText } : {}),
              ...(context.selectedText ? { selectedText: context.selectedText } : {}),
            },
          });
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

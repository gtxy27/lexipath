import { createRoot, Root } from "react-dom/client";
import React from "react";
import browser from "webextension-polyfill";
import { FloatingButton } from "./floating-button";
import { Settings } from "@lexipath/core";
import { sendMessage } from "../../../shared/messages";

export class FloatingButtonController {
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private root: Root | null = null;
  private settings: Settings | null = null;

  constructor(settings: Settings | null) {
    this.settings = settings;
  }

  mount() {
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

  updateSettings(settings: Settings) {
    this.settings = settings;
    this.render();
  }

  private render() {
    if (!this.root) return;

    this.root.render(
      <FloatingButton
        initialEnabled={this.settings?.enabled ?? true}
        onToggleEnabled={(enabled) => {
          sendMessage("SET_SETTINGS", { enabled });
        }}
        onOpenSidebar={() => {
          sendMessage("OPEN_SIDEBAR", { isAutoSend: false });
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

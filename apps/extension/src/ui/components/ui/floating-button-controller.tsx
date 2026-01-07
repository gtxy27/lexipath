import { createRoot, Root } from "react-dom/client";
import React from "react";
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
    this.container.style.cssText = "position: fixed; z-index: 2147483647; pointer-events: none;";
    
    // Use Shadow DOM for style isolation
    this.shadow = this.container.attachShadow({ mode: "open" });
    
    // Inject Tailwind/Global styles into Shadow DOM
    // Since we are using Tailwind classes in the React component, 
    // we need to inject the compiled CSS here.
    const styleLink = document.createElement("link");
    styleLink.rel = "stylesheet";
    styleLink.href = browser.runtime.getURL("dist/ui/styles.css"); 
    this.shadow.appendChild(styleLink);

    const rootEl = document.createElement("div");
    rootEl.style.cssText = "pointer-events: none;";
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
        onOpenSettings={() => {
          sendMessage("OPEN_OPTIONS_PAGE", undefined);
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

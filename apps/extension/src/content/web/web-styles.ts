import type { Settings } from "@lexipath/core";
import { ENHANCE_PAUSED_CLASS, SHOW_ORIGINAL_CLASS } from "../../shared/tab-state";

let stylesInjected = false;
let injectedStylesKey: string | null = null;

export function ensureWebStylesInjected(options: {
  settings: Settings | null;
  theme: "light" | "dark";
}): void {
  const customCss = options.settings?.webCustomCss?.trim() ?? "";
  const nextStylesKey = `${options.theme}::${customCss}`;

  const isDark = options.theme === "dark";
  const tooltipBg = isDark
    ? "rgba(15, 23, 42, 0.92)"
    : "rgba(255, 255, 255, 0.98)";
  const tooltipText = isDark ? "#ffffff" : "#1e293b";
  const tooltipShadow = isDark
    ? "0 10px 30px rgba(0, 0, 0, 0.35)"
    : "0 10px 30px rgba(0, 0, 0, 0.1)";
  const tooltipBorder = isDark
    ? "1px solid rgba(148, 163, 184, 0.2)"
    : "1px solid rgba(226, 232, 240, 0.8)";

  let styleEl = document.getElementById("lexipath-styles") as HTMLStyleElement | null;
  if (stylesInjected && injectedStylesKey === nextStylesKey && styleEl) {
    return;
  }

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "lexipath-styles";
    document.documentElement.appendChild(styleEl);
  }

  styleEl.textContent = `
	     .lexipath-word {
	       cursor: pointer;
	       position: relative;
	       border-radius: 3px;
	       padding: 0 2px;
	       border-bottom: 2px dotted var(--lx-word-color, #3b82f6);
	       background: rgba(59, 130, 246, 0.12);
	     }

	     /* Avoid changing table layout (padding/background can expand rows/cells). */
	     table .lexipath-word,
	     td .lexipath-word,
	     th .lexipath-word {
	       padding: 0 !important;
	       background: transparent !important;
	       border-bottom: none !important;
	       border-radius: 0 !important;
	       cursor: inherit !important;
	     }

     @media (pointer: coarse) {
       .lexipath-word {
         border-bottom-width: 3px;
         padding: 2px 0;
       }
     }

     /* plan15: style key system (data-lx-style="<key>") */
     [data-lx-style="border"] {
       border-bottom-style: dotted;
     }
     [data-lx-style="dashedLine"] {
       border-bottom-style: dashed;
       background: rgba(99, 102, 241, 0.10);
     }
     [data-lx-style="weakened"] {
       opacity: 0.85;
       background: rgba(244, 63, 94, 0.10);
     }
     [data-lx-style="background"] {
       background: rgba(34, 197, 94, 0.10);
     }
     [data-lx-style="textColor"] {
       color: ${isDark ? "#e2e8f0" : "#0f172a"};
       background: rgba(148, 163, 184, 0.12);
     }

     /* plan15: original/enhanced toggle */
     .lexipath-word__original {
       display: none;
     }
     .${SHOW_ORIGINAL_CLASS} .lexipath-word__original {
       display: inline;
     }
     .${SHOW_ORIGINAL_CLASS} .lexipath-word__enhanced {
       display: none;
     }

     .lexipath-paragraph-original {
       display: none;
     }
     .${SHOW_ORIGINAL_CLASS} .lexipath-paragraph-original {
       display: inline;
     }
     .${SHOW_ORIGINAL_CLASS} .lexipath-paragraph-enhanced {
       display: none;
     }

     /* plan15: cancel enhancement (pause) should look like the original page. */
     .${ENHANCE_PAUSED_CLASS} .lexipath-word {
       cursor: text;
       padding: 0 !important;
       background: transparent !important;
       border-bottom: none !important;
       border-radius: 0 !important;
     }
     .${ENHANCE_PAUSED_CLASS} .lexipath-word__original {
       display: inline;
     }
     .${ENHANCE_PAUSED_CLASS} .lexipath-word__enhanced {
       display: none;
     }
     .${ENHANCE_PAUSED_CLASS} .lexipath-paragraph-original {
       display: inline;
     }
     .${ENHANCE_PAUSED_CLASS} .lexipath-paragraph-enhanced {
       display: none;
     }

	    .lexipath-processing {
	      background: rgba(59, 130, 246, 0.08) !important;
	      transition: background 150ms ease-out;
	    }

	    table .lexipath-processing,
	    td.lexipath-processing,
	    th.lexipath-processing {
	      background: transparent !important;
	    }

     #lexipath-tooltip {
      position: fixed;
      z-index: 2147483647;
      max-width: min(420px, calc(100vw - 24px));
      padding: 6px 10px;
      border-radius: 8px;
      background: ${tooltipBg};
      color: ${tooltipText};
      font-size: 13px;
      line-height: 1.35;
      box-shadow: ${tooltipShadow};
      border: ${tooltipBorder};
      pointer-events: none;
      white-space: pre-wrap;
       backdrop-filter: blur(6px);
     }

     ${customCss}
   `;

  stylesInjected = true;
  injectedStylesKey = nextStylesKey;
}


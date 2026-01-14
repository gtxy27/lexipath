import type { WebEnhanceOutput } from "@lexipath/core";
import { createEnhancedElement, createEnhancedRenderer, type EnhancedTextOptions, type WordRenderMode } from "../enhanced-text";

export function injectFullParagraph(options: {
  element: Element;
  originalText: string;
  enhancedText: string;
  enhanced: WebEnhanceOutput;
  enhancedTextOptions: EnhancedTextOptions;
}): void {
  const { element, originalText, enhancedText, enhanced, enhancedTextOptions } = options;

  element.textContent = "";

  const originalSpan = document.createElement("span");
  originalSpan.className = "lexipath-paragraph-original";
  originalSpan.textContent = originalText;

  const enhancedSpan = document.createElement("span");
  enhancedSpan.className = "lexipath-paragraph-enhanced";
  enhancedSpan.appendChild(
    createEnhancedElement(
      enhancedText,
      enhanced,
      "target-to-native",
      enhancedTextOptions,
    ),
  );

  element.appendChild(originalSpan);
  element.appendChild(enhancedSpan);
}

export function injectInlineWords(options: {
  element: Element;
  enhanced: WebEnhanceOutput;
  renderMode: WordRenderMode;
  enhancedTextOptions: EnhancedTextOptions;
}): { textNodes: number } {
  const { element, enhanced, renderMode, enhancedTextOptions } = options;

  const renderEnhanced = createEnhancedRenderer(enhanced, renderMode, enhancedTextOptions);

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent && node.textContent.trim().length > 0) {
      textNodes.push(node);
    }
  }

  for (const textNode of textNodes) {
    const nodeText = textNode.textContent || "";
    const enhancedFragment = renderEnhanced(nodeText);
    const parent = textNode.parentNode;
    if (parent) {
      parent.replaceChild(enhancedFragment, textNode);
    }
  }

  return { textNodes: textNodes.length };
}


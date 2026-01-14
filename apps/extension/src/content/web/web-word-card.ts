import type { Settings } from "@lexipath/core";
import { createLogger } from "@lexipath/core/log";
import { sendMessage } from "../../shared/messages";
import { getI18nMessage } from "../i18n";
import { SubtitleOverlay, type WordCardData } from "../ui";
import { FLOATING_BUTTON_CONTAINER_ID } from "../ui/floating-button-constants";
import { resolveWordCardTtsLang } from "../wordcard";

type ContextWindow = { before: string[]; after: string[] };

export type WebWordCardManager = Readonly<{
  setSettings: (settings: Settings | null) => void;
  setTheme: (theme: "light" | "dark") => void;
  hide: () => void;
  isVisible: () => boolean;
  show: (word: string, rect: DOMRect, options?: { pinned?: boolean; contextWindow?: ContextWindow | null }) => void;
  ensureSelectionExplainInjected: () => void;
}>;

const log = createLogger("web-wordcard");

function clampContextSentences(settings: Settings | null): number {
  const raw = settings?.llmContextSentences;
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 0;
  return Math.max(0, Math.min(6, n));
}

function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const out: string[] = [];
  const regex = /[^.!?。！？]+[.!?。！？]?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(normalized)) !== null) {
    const part = (match[0] ?? "").trim();
    if (!part) continue;
    out.push(part);
    if (out.length >= 80) break;
  }
  return out.length ? out : [normalized];
}

function extractContextWindowFromSelection(word: string, settings: Settings | null): ContextWindow | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const windowSize = clampContextSentences(settings);
  if (windowSize <= 0) return null;

  try {
    const range = selection.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el =
      node instanceof Element
        ? node
        : node && (node as any).parentElement instanceof Element
          ? (node as any).parentElement
          : null;
    if (!el) return null;

    const container = el.closest("p, li, blockquote, dd, dt, article, section, main, div") ?? el;
    if (!(container instanceof HTMLElement)) return null;

    const text = (container.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!text) return null;

    const sentences = splitIntoSentences(text);
    if (sentences.length === 0) return null;

    const needle = word.trim().toLowerCase();
    const joined = sentences.join(" ");
    const idx = needle ? joined.toLowerCase().indexOf(needle) : -1;

    let sentenceIndex = 0;
    if (idx >= 0) {
      let cursor = 0;
      for (let i = 0; i < sentences.length; i += 1) {
        const s = sentences[i] ?? "";
        const nextCursor = cursor + s.length + 1;
        if (idx >= cursor && idx < nextCursor) {
          sentenceIndex = i;
          break;
        }
        cursor = nextCursor;
      }
    }

    const start = Math.max(0, sentenceIndex - windowSize);
    const end = Math.min(sentences.length - 1, sentenceIndex + windowSize);

    const before = sentences.slice(start, sentenceIndex);
    const after = sentences.slice(sentenceIndex + 1, end + 1);
    const center = sentences[sentenceIndex]?.trim() ?? "";
    if (center) before.push(center);

    if (before.length === 0 && after.length === 0) return null;
    return { before, after };
  } catch (error: unknown) {
    void error;
    return null;
  }
}

function normalizeWordKey(raw: string): string {
  return raw.toLowerCase().trim();
}

export function createWebWordCardManager(options: {
  getSettings: () => Settings | null;
  getResolvedTheme: () => "light" | "dark";
}): WebWordCardManager {
  let overlay: SubtitleOverlay | null = null;
  let selectionExplainInjected = false;
  const wordExplainCache = new Map<string, WordCardData>();
  const wordExplainInFlight = new Map<string, Promise<WordCardData>>();

  const ensureOverlay = (): SubtitleOverlay => {
    if (overlay) {
      overlay.setTheme(options.getResolvedTheme());
      overlay.setWordCardConfig({
        sectionsOrder: options.getSettings()?.wordCardSectionsOrder ?? [
          "definition",
          "translation",
          "example",
          "exampleTranslation",
        ],
        autoPronounce: options.getSettings()?.wordCardAutoPronounce ?? true,
        ttsLang: resolveWordCardTtsLang(options.getSettings()),
      });
      return overlay;
    }

    overlay = new SubtitleOverlay("youtube", {
      theme: options.getResolvedTheme(),
      onWordClick: (word, rect) => show(word, rect, { pinned: true }),
    });
    overlay.setWordCardConfig({
      sectionsOrder: options.getSettings()?.wordCardSectionsOrder ?? [
        "definition",
        "translation",
        "example",
        "exampleTranslation",
      ],
      autoPronounce: options.getSettings()?.wordCardAutoPronounce ?? true,
      ttsLang: resolveWordCardTtsLang(options.getSettings()),
    });
    overlay.mount();
    return overlay;
  };

  const getWordCardData = async (word: string, contextWindow?: ContextWindow | null): Promise<WordCardData> => {
    const normalized = normalizeWordKey(word);
    const cached = wordExplainCache.get(normalized);
    if (cached) return cached;

    const inFlight = wordExplainInFlight.get(normalized);
    if (inFlight) return inFlight;

    const promise = (async () => {
      const response = await sendMessage("EXPLAIN_WORD", {
        word: normalized,
        ...(contextWindow && (contextWindow.before.length || contextWindow.after.length)
          ? { contextBefore: contextWindow.before, contextAfter: contextWindow.after }
          : {}),
      });
      if (!response.ok) {
        return {
          word: normalized,
          definition: getI18nMessage("wordCard_definitionFailed"),
        };
      }
      const data = response.value as any;
      const card: WordCardData = {
        word: data.word || normalized,
        definition: data.definition || getI18nMessage("wordCard_definitionUnavailable"),
        phonetic: data.phonetic,
        difficulty: data.difficulty,
        translation: data.translation,
        example: data.example,
        exampleTranslation: data.example_translation,
      };
      wordExplainCache.set(normalized, card);
      return card;
    })().finally(() => wordExplainInFlight.delete(normalized));

    wordExplainInFlight.set(normalized, promise);
    return promise;
  };

  const show = async (
    word: string,
    rect: DOMRect,
    opts?: { pinned?: boolean; contextWindow?: ContextWindow | null }
  ) => {
    const pinned = opts?.pinned ?? false;
    const contextWindow = opts?.contextWindow ?? null;
    const normalized = normalizeWordKey(word);
    if (!normalized) return;

    if (normalized) {
      void sendMessage("REPORT_USAGE_EVENT", { event: "word_card_opened", word: normalized, scene: "web" });
    }

    const webOverlay = ensureOverlay();
    webOverlay.showWordCardLoading(word, rect, { pinned });

    try {
      const data = await getWordCardData(word, contextWindow);
      webOverlay.showWordCard(data, rect, { pinned });
    } catch (error: unknown) {
      log.debug("getWordCardData failed", { error });
      webOverlay.showWordCard(
        { word: normalized, definition: getI18nMessage("wordCard_definitionUnavailable") },
        rect,
        { pinned }
      );
    }
  };

  const ensureSelectionExplainInjected = () => {
    if (selectionExplainInjected) return;
    selectionExplainInjected = true;

    const isInsideLexipathUi = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      if (target.closest("#lexipath-subtitle-overlay")) return true;
      if (target.closest(`#${FLOATING_BUTTON_CONTAINER_ID}`)) return true;
      if (target.closest("#lexipath-tooltip")) return true;
      return false;
    };

    const normalizeSelectedWord = (raw: string): string => {
      const trimmed = raw.trim();
      if (!trimmed) return "";

      try {
        const cleaned = trimmed.replace(/^[^\p{L}\p{M}']+|[^\p{L}\p{M}']+$/gu, "");
        if (!cleaned) return "";
        if (cleaned.length > 60) return "";
        if (/\s/u.test(cleaned)) return "";
        if (!/^[\p{L}\p{M}'’]+$/u.test(cleaned)) return "";
        return cleaned;
      } catch (error: unknown) {
        void error;
        const cleaned = trimmed.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "");
        if (!cleaned) return "";
        if (cleaned.length > 60) return "";
        if (/\s/.test(cleaned)) return "";
        if (!/^[A-Za-z0-9'’]+$/.test(cleaned)) return "";
        return cleaned;
      }
    };

    const getSelectionAnchorRect = (fallbackEvent: MouseEvent): DOMRect => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return new DOMRect(fallbackEvent.clientX, fallbackEvent.clientY, 1, 1);
      }
      try {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        if (rect && (rect.width > 0 || rect.height > 0)) return rect;
      } catch (error: unknown) {
        void error;
      }
      return new DOMRect(fallbackEvent.clientX, fallbackEvent.clientY, 1, 1);
    };

    let lastOpenAt = 0;
    const tryOpenFromSelection = (event: MouseEvent) => {
      const settings = options.getSettings();
      if (!settings?.enabled) return;
      if ((settings.webSelectionExplainEnabled ?? true) === false) return;
      if (isInsideLexipathUi(event.target)) return;

      const now = Date.now();
      if (now - lastOpenAt < 250) return;

      const selection = window.getSelection();
      const selectedText = selection?.toString?.() ?? "";
      const word = normalizeSelectedWord(selectedText);
      if (!word) return;

      lastOpenAt = now;
      const rect = getSelectionAnchorRect(event);
      const contextWindow = extractContextWindowFromSelection(word, settings);
      void show(word, rect, { pinned: true, contextWindow });
    };

    document.addEventListener("dblclick", tryOpenFromSelection, true);
    document.addEventListener(
      "mouseup",
      (event) => {
        if (event.detail !== 2) return;
        tryOpenFromSelection(event);
      },
      true
    );
  };

  const hide = () => {
    try {
      ensureOverlay().hideWordCard?.();
    } catch (error: unknown) {
      void error;
    }
  };

  const isVisible = () => {
    try {
      return Boolean(overlay && (overlay as any).wordCardVisible);
    } catch (error: unknown) {
      void error;
      return false;
    }
  };

  const setSettings = (settings: Settings | null) => {
    if (!overlay) return;
    overlay.setTheme(options.getResolvedTheme());
    overlay.setWordCardConfig({
      sectionsOrder: settings?.wordCardSectionsOrder ?? ["definition", "translation", "example", "exampleTranslation"],
      autoPronounce: settings?.wordCardAutoPronounce ?? true,
      ttsLang: resolveWordCardTtsLang(settings),
    });
  };

  const setTheme = (theme: "light" | "dark") => {
    if (!overlay) return;
    overlay.setTheme(theme);
  };

  return Object.freeze({
    setSettings,
    setTheme,
    hide,
    isVisible,
    show: (word, rect, options) => {
      void show(word, rect, options);
    },
    ensureSelectionExplainInjected,
  });
}

/**
 * Subtitle Overlay Component
 *
 * Renders subtitles using Shadow DOM for style isolation.
 * Supports both overlay (on video) and below-video positioning.
 */

import { getI18nMessage } from '../i18n';
import { sendMessage } from '../../shared/messages';

export type SubtitleMode = 'enhanced' | 'bilingual' | 'bilingual-temp';

export interface SubtitleLine {
  text: string;
  isEnhanced: boolean; // true for enhanced line, false for original
}

export interface SubtitleDisplayOptions {
  mode: SubtitleMode;
  lines: SubtitleLine[];
  interactiveWords?: Set<string>;
}

export interface WordCardData {
  word: string;
  definition: string;
  phonetic?: string;
  difficulty?: string;
  translation?: string;
  example?: string;
  exampleTranslation?: string;
}

/**
 * Platform-specific video container selector
 */
export function getVideoContainerSelector(platform: 'youtube' | 'bilibili'): string {
  switch (platform) {
    case 'youtube':
      return '#movie_player';
    case 'bilibili':
      return '.bpx-player-container, .bilibili-player-video-wrap';
    default:
      return '';
  }
}

/**
 * Subtitle overlay manager
 */
export class SubtitleOverlay {
  private container: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private subtitleElement: HTMLDivElement | null = null;
  private subtitleLinesElement: HTMLDivElement | null = null;
  private subtitleModeButton: HTMLButtonElement | null = null;
  private wordCardElement: HTMLDivElement | null = null;
  private videoContainer: HTMLElement | null = null;
  private videoContainerInlinePosition: string | null = null;
  private forcedVideoContainerPosition = false;
  private platform: 'youtube' | 'bilibili';
  private mode: SubtitleMode = 'enhanced';
  private theme: 'light' | 'dark' = 'dark';
  private onModeChange?: (mode: SubtitleMode) => void;
  private onWordClick?: (word: string, anchorRect: DOMRect) => void;
  private onWordHover?: (word: string, anchorRect: DOMRect) => void;
  private documentClickListenerAttached = false;
  public wordCardVisible = false;
  private wordCardPinned = false;
  private hoverWord: string | null = null;
  private hoverRect: DOMRect | null = null;
  private hoverOpenTimer: number | null = null;
  private hoverCloseTimer: number | null = null;
  private readonly hoverOpenDelayMs = 250;
  private readonly hoverCloseDelayMs = 250;
  private fontSizeObserver: ResizeObserver | null = null;
  private fontSizeUpdateTimer: number | null = null;
  private lastMainFontSizePx: number | null = null;
  private lastOriginalFontSizePx: number | null = null;

  constructor(
    platform: 'youtube' | 'bilibili',
    options?: {
      theme?: 'light' | 'dark';
      onModeChange?: (mode: SubtitleMode) => void;
      onWordClick?: (word: string, anchorRect: DOMRect) => void;
      onWordHover?: (word: string, anchorRect: DOMRect) => void;
    }
  ) {
    this.platform = platform;
    this.theme = options?.theme === 'light' ? 'light' : 'dark';
    if (options?.onModeChange) {
      this.onModeChange = options.onModeChange;
    }
    if (options?.onWordClick) {
      this.onWordClick = options.onWordClick;
    }
    if (options?.onWordHover) {
      this.onWordHover = options.onWordHover;
    }
  }

  /**
   * Initialize and mount the subtitle overlay
   */
  mount(): boolean {
    if (this.container) {
      console.warn('[SubtitleOverlay] Already mounted');
      return true;
    }

    const videoContainer = this.findVideoContainer();
    if (!videoContainer) {
      console.error('[SubtitleOverlay] Video container not found');
      return false;
    }
    this.videoContainer = videoContainer;
    this.ensureVideoContainerPositioned();

    // Create container
    this.container = document.createElement('div');
    this.container.id = 'lexipath-subtitle-overlay';
    this.container.style.cssText = `
      position: absolute;
      bottom: 60px;
      left: 0;
      right: 0;
      pointer-events: none;
      z-index: 10000;
      display: flex;
      justify-content: center;
      align-items: flex-end;
    `;

    // Create Shadow DOM
    this.shadow = this.container.attachShadow({ mode: 'open' });
    this.shadow.textContent = '';

    const styleEl = document.createElement('style');
    styleEl.textContent = this.getStyles();
    this.shadow.appendChild(styleEl);

    const subtitleEl = document.createElement('div');
    subtitleEl.className = 'lexipath-subtitle';
    const controlsEl = document.createElement('div');
    controlsEl.className = 'lexipath-subtitle__controls';

    const modeButton = document.createElement('button');
    modeButton.type = 'button';
    modeButton.className = 'lexipath-subtitle__mode-toggle';
    modeButton.textContent = this.getModeLabel(this.mode);
    modeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleMode();
    });

    controlsEl.appendChild(modeButton);
    subtitleEl.appendChild(controlsEl);

    const linesEl = document.createElement('div');
    linesEl.className = 'lexipath-subtitle__lines';
    subtitleEl.appendChild(linesEl);

    this.shadow.appendChild(subtitleEl);

    const wordCardEl = document.createElement('div');
    wordCardEl.className = 'lexipath-wordcard';
    wordCardEl.setAttribute('aria-hidden', 'true');
    this.shadow.appendChild(wordCardEl);

    // Get subtitle element
    this.subtitleElement = subtitleEl;
    this.subtitleLinesElement = linesEl;
    this.subtitleModeButton = modeButton;
    this.wordCardElement = wordCardEl;

    // Setup click handler for mode switching
    if (this.subtitleElement) {
      this.subtitleElement.style.pointerEvents = 'auto';
      this.subtitleElement.style.cursor = 'pointer';
      this.subtitleElement.addEventListener('click', this.handleClick);
      this.subtitleElement.addEventListener('mousemove', this.handleMouseMove);
      this.subtitleElement.addEventListener('mouseleave', this.handleMouseLeave);
    }

    if (this.wordCardElement) {
      this.wordCardElement.addEventListener('mouseenter', this.handleWordCardMouseEnter);
      this.wordCardElement.addEventListener('mouseleave', this.handleWordCardMouseLeave);
    }

    // Append to video container
    videoContainer.appendChild(this.container);
    this.setupAutoFontSizing();

    console.log('[SubtitleOverlay] Mounted successfully');
    return true;
  }

  /**
   * Unmount and cleanup
   */
  unmount(): void {
    this.teardownAutoFontSizing();
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.detachDocumentClickListener();
    this.clearHoverTimers();
    this.container = null;
    this.shadow = null;
    this.subtitleElement = null;
    this.subtitleLinesElement = null;
    this.subtitleModeButton = null;
    this.wordCardElement = null;
    this.restoreVideoContainerPositioning();
    this.videoContainer = null;
  }

  private ensureVideoContainerPositioned(): void {
    const container = this.videoContainer;
    if (!container) return;

    try {
      const computed = window.getComputedStyle(container);
      if (computed.position !== 'static') return;
    } catch {
      return;
    }

    this.videoContainerInlinePosition = container.style.position;
    container.style.position = 'relative';
    this.forcedVideoContainerPosition = true;
  }

  private restoreVideoContainerPositioning(): void {
    const container = this.videoContainer;
    if (!container) return;
    if (!this.forcedVideoContainerPosition) return;

    container.style.position = this.videoContainerInlinePosition ?? '';
    this.videoContainerInlinePosition = null;
    this.forcedVideoContainerPosition = false;
  }

  private setupAutoFontSizing(): void {
    if (!this.container || !this.videoContainer) return;
    this.updateSubtitleFontSize();

    if (typeof ResizeObserver === 'undefined') return;
    this.fontSizeObserver = new ResizeObserver(() => {
      this.scheduleSubtitleFontSizeUpdate();
    });

    this.fontSizeObserver.observe(this.videoContainer);
    const video = this.videoContainer.querySelector('video');
    if (video instanceof HTMLElement) {
      this.fontSizeObserver.observe(video);
    }
  }

  private teardownAutoFontSizing(): void {
    if (this.fontSizeUpdateTimer !== null) {
      window.clearTimeout(this.fontSizeUpdateTimer);
      this.fontSizeUpdateTimer = null;
    }
    if (this.fontSizeObserver) {
      this.fontSizeObserver.disconnect();
      this.fontSizeObserver = null;
    }
    this.lastMainFontSizePx = null;
    this.lastOriginalFontSizePx = null;
  }

  private scheduleSubtitleFontSizeUpdate(): void {
    if (this.fontSizeUpdateTimer !== null) return;
    this.fontSizeUpdateTimer = window.setTimeout(() => {
      this.fontSizeUpdateTimer = null;
      this.updateSubtitleFontSize();
    }, 100);
  }

  private updateSubtitleFontSize(): void {
    if (!this.container || !this.videoContainer) return;

    const heightPx = this.getVideoHeightPx();
    if (!Number.isFinite(heightPx) || heightPx <= 0) return;

    const mainSizePx = Math.max(14, Math.min(60, Math.round(heightPx * 0.04)));
    const originalSizePx = Math.max(10, Math.round(mainSizePx * 0.8));

    if (this.lastMainFontSizePx !== mainSizePx) {
      this.container.style.setProperty('--lexipath-subtitle-font-size', `${mainSizePx}px`);
      this.lastMainFontSizePx = mainSizePx;
    }

    if (this.lastOriginalFontSizePx !== originalSizePx) {
      this.container.style.setProperty('--lexipath-subtitle-original-font-size', `${originalSizePx}px`);
      this.lastOriginalFontSizePx = originalSizePx;
    }
  }

  private getVideoHeightPx(): number {
    const container = this.videoContainer;
    if (!container) return 0;

    const video = container.querySelector('video');
    if (video instanceof HTMLVideoElement) {
      const rect = video.getBoundingClientRect();
      if (rect.height > 0) return rect.height;
      if (video.clientHeight > 0) return video.clientHeight;
    }

    const rect = container.getBoundingClientRect();
    return rect.height;
  }

  /**
   * Update subtitle display
   */
  display(options: SubtitleDisplayOptions): void {
    if (!this.subtitleElement || !this.subtitleLinesElement) {
      console.warn('[SubtitleOverlay] Not mounted');
      return;
    }

    this.mode = options.mode;
    const { lines } = options;
    this.updateModeLabel();

    if (lines.length === 0) {
      this.clear();
      return;
    }

    this.subtitleLinesElement.textContent = '';
    for (const line of lines) {
      const div = document.createElement('div');
      div.className = line.isEnhanced ? 'line-enhanced' : 'line-original';
      this.renderLineWithWordSpans(div, line.text, options.interactiveWords);
      this.subtitleLinesElement.appendChild(div);
    }
    this.subtitleElement.classList.add('visible');
  }

  /**
   * Clear subtitle display
   */
  clear(): void {
    if (!this.subtitleElement || !this.subtitleLinesElement) return;
    this.subtitleLinesElement.textContent = '';
    this.subtitleElement.classList.remove('visible');
    this.hideWordCard();
  }

  /**
   * Set theme
   */
  setTheme(theme: 'light' | 'dark'): void {
    if (this.theme === theme) return;
    this.theme = theme;
    if (this.shadow) {
      const styleEl = this.shadow.querySelector('style');
      if (styleEl) {
        styleEl.textContent = this.getStyles();
      }
    }
  }

  /**
   * Handle click to toggle mode
   */
  private handleClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const word = target?.dataset?.lexipathWord;
    if (word && this.onWordClick) {
      event.stopPropagation();
      const rect = target.getBoundingClientRect();
      this.onWordClick(word, rect);
      return;
    }

    this.toggleMode();
  };

  private toggleMode(): void {
    const nextMode: SubtitleMode = this.mode === 'enhanced' ? 'bilingual' : 'enhanced';
    this.mode = nextMode;
    this.updateModeLabel();
    this.onModeChange?.(nextMode);
  }

  private updateModeLabel(): void {
    if (!this.subtitleModeButton) return;
    this.subtitleModeButton.textContent = this.getModeLabel(this.mode);
  }

  private getModeLabel(mode: SubtitleMode): string {
    switch (mode) {
      case 'enhanced':
        return getI18nMessage('subtitle_modeSingle', undefined, mode);
      case 'bilingual':
        return getI18nMessage('subtitle_modeBilingual', undefined, mode);
      case 'bilingual-temp':
        return getI18nMessage('subtitle_modeBilingualHold', undefined, mode);
      default:
        return getI18nMessage('subtitle_modeSingle', undefined, mode);
    }
  }

  showWordCardLoading(word: string, anchorRect: DOMRect, options?: { pinned?: boolean }): void {
    const loadingText = getI18nMessage('wordCard_loading', undefined, getI18nMessage('loading'));
    this.showWordCard(
      {
        word,
        definition: loadingText,
      },
      anchorRect,
      options
    );
  }

  showWordCard(data: WordCardData, anchorRect: DOMRect, options?: { pinned?: boolean }): void {
    if (!this.wordCardElement) return;

    this.wordCardPinned = options?.pinned ?? this.wordCardPinned;
    this.wordCardElement.textContent = '';

    const header = document.createElement('div');
    header.className = 'lexipath-wordcard__header';

    const title = document.createElement('div');
    title.className = 'lexipath-wordcard__title';
    title.textContent = data.word;
    header.appendChild(title);

    const metaParts: string[] = [];
    if (data.phonetic) metaParts.push(data.phonetic);
    if (data.difficulty) metaParts.push(data.difficulty);
    if (data.translation) metaParts.push(data.translation);

    if (metaParts.length > 0) {
      const meta = document.createElement('div');
      meta.className = 'lexipath-wordcard__meta';
      meta.textContent = metaParts.join(' · ');
      header.appendChild(meta);
    }

    const body = document.createElement('div');
    body.className = 'lexipath-wordcard__body';

    const definition = document.createElement('div');
    definition.className = 'lexipath-wordcard__definition';
    definition.textContent = data.definition;
    body.appendChild(definition);

    if (data.example) {
      const example = document.createElement('div');
      example.className = 'lexipath-wordcard__example';
      example.textContent = data.example;
      body.appendChild(example);
    }

    if (data.exampleTranslation) {
      const exampleTranslation = document.createElement('div');
      exampleTranslation.className = 'lexipath-wordcard__example-translation';
      exampleTranslation.textContent = data.exampleTranslation;
      body.appendChild(exampleTranslation);
    }

    this.wordCardElement.appendChild(header);
    this.wordCardElement.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'lexipath-wordcard__footer';

    const chatButton = document.createElement('button');
    chatButton.className = 'lexipath-wordcard__chat-button';
    chatButton.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6 6-6"/></svg>
      <span>${getI18nMessage('wordCard_askAI') || 'Ask AI'}</span>
    `;
    chatButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const prompt = `Please explain the usage of the word "${data.word}" in this context${data.example ? `: "${data.example}"` : ''}.`;
      sendMessage('OPEN_SIDEBAR', { initialMessage: prompt, isAutoSend: true });
      this.hideWordCard();
    });
    footer.appendChild(chatButton);
    this.wordCardElement.appendChild(footer);

    const { top, left } = this.computeWordCardPosition(anchorRect);
    this.wordCardElement.style.top = `${top}px`;
    this.wordCardElement.style.left = `${left}px`;

    this.wordCardVisible = true;
    this.wordCardElement.classList.add('visible');
    this.wordCardElement.setAttribute('aria-hidden', 'false');
    this.attachDocumentClickListener();
  }

  hideWordCard(): void {
    if (!this.wordCardElement) return;
    if (!this.wordCardVisible) return;
    this.wordCardVisible = false;
    this.wordCardPinned = false;
    this.wordCardElement.classList.remove('visible');
    this.wordCardElement.setAttribute('aria-hidden', 'true');
    this.detachDocumentClickListener();
  }

  private attachDocumentClickListener(): void {
    if (this.documentClickListenerAttached) return;
    this.documentClickListenerAttached = true;
    document.addEventListener('mousedown', this.handleDocumentMouseDown);
    document.addEventListener('keydown', this.handleDocumentKeyDown);
  }

  private detachDocumentClickListener(): void {
    if (!this.documentClickListenerAttached) return;
    this.documentClickListenerAttached = false;
    document.removeEventListener('mousedown', this.handleDocumentMouseDown);
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
  }

  private handleDocumentMouseDown = (event: MouseEvent): void => {
    if (!this.wordCardVisible) return;
    if (!this.container) return;
    const path = (event.composedPath?.() ?? []) as unknown[];
    if (path.includes(this.container)) return;
    this.hideWordCard();
  };

  private handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!this.wordCardVisible) return;
    if (event.key === 'Escape') {
      this.hideWordCard();
    }
  };

  private handleWordCardMouseEnter = (): void => {
    this.clearHoverCloseTimer();
  };

  private handleWordCardMouseLeave = (): void => {
    if (this.wordCardPinned) return;
    this.scheduleHoverClose();
  };

  private handleMouseMove = (event: MouseEvent): void => {
    if (this.wordCardPinned) return;

    const target = event.target as HTMLElement | null;
    const wordEl = target?.closest?.('[data-lexipath-word]') as HTMLElement | null;
    const word = wordEl?.dataset?.lexipathWord ?? '';
    if (!wordEl || !word) {
      this.hoverWord = null;
      this.hoverRect = null;
      this.clearHoverOpenTimer();
      this.scheduleHoverClose();
      return;
    }

    const rect = wordEl.getBoundingClientRect();
    if (this.hoverWord === word) {
      this.hoverRect = rect;
      return;
    }

    this.hoverWord = word;
    this.hoverRect = rect;
    this.clearHoverCloseTimer();
    this.clearHoverOpenTimer();

    const onWordHover = this.onWordHover;
    if (!onWordHover) return;
    this.hoverOpenTimer = window.setTimeout(() => {
      if (this.wordCardPinned) return;
      if (!this.hoverWord || !this.hoverRect) return;
      onWordHover(this.hoverWord, this.hoverRect);
    }, this.hoverOpenDelayMs);
  };

  private handleMouseLeave = (): void => {
    if (this.wordCardPinned) return;
    this.hoverWord = null;
    this.hoverRect = null;
    this.clearHoverOpenTimer();
    this.scheduleHoverClose();
  };

  private scheduleHoverClose(): void {
    if (this.wordCardPinned) return;
    if (!this.wordCardVisible) return;
    if (this.hoverCloseTimer !== null) return;
    this.hoverCloseTimer = window.setTimeout(() => {
      this.hoverCloseTimer = null;
      if (this.wordCardPinned) return;
      if (this.hoverWord) return;
      this.hideWordCard();
    }, this.hoverCloseDelayMs);
  }

  private clearHoverTimers(): void {
    this.clearHoverOpenTimer();
    this.clearHoverCloseTimer();
  }

  private clearHoverOpenTimer(): void {
    if (this.hoverOpenTimer === null) return;
    window.clearTimeout(this.hoverOpenTimer);
    this.hoverOpenTimer = null;
  }

  private clearHoverCloseTimer(): void {
    if (this.hoverCloseTimer === null) return;
    window.clearTimeout(this.hoverCloseTimer);
    this.hoverCloseTimer = null;
  }

  private computeWordCardPosition(anchorRect: DOMRect): { top: number; left: number } {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const MARGIN = 10;
    const PREFERRED_OFFSET = 10;
    const CARD_WIDTH = 320;
    const CARD_HEIGHT = 160;

    let top = anchorRect.top - CARD_HEIGHT - PREFERRED_OFFSET;
    let left = anchorRect.left + anchorRect.width / 2 - CARD_WIDTH / 2;

    if (left < MARGIN) left = MARGIN;
    if (left + CARD_WIDTH > viewportWidth - MARGIN) left = viewportWidth - CARD_WIDTH - MARGIN;

    if (top < MARGIN) {
      top = anchorRect.bottom + PREFERRED_OFFSET;
      if (top + CARD_HEIGHT > viewportHeight - MARGIN) top = viewportHeight - CARD_HEIGHT - MARGIN;
    }

    return { top, left };
  }

  private renderLineWithWordSpans(container: HTMLElement, text: string, interactiveWords?: Set<string>): void {
    if (!interactiveWords) {
      this.renderAllWords(container, text);
      return;
    }

    if (interactiveWords.size === 0) {
      container.appendChild(document.createTextNode(text));
      return;
    }

    const terms = Array.from(interactiveWords)
      .map((term) => this.normalizeTerm(term))
      .filter(Boolean);

    if (terms.length === 0) {
      container.appendChild(document.createTextNode(text));
      return;
    }

    const matches = this.findNonOverlappingTermMatches(text, terms);
    if (matches.length === 0) {
      container.appendChild(document.createTextNode(text));
      return;
    }

    let lastIndex = 0;
    for (const match of matches) {
      if (match.start > lastIndex) {
        container.appendChild(document.createTextNode(text.slice(lastIndex, match.start)));
      }

      const span = document.createElement('span');
      span.className = 'lexipath-subtitle-word';
      span.textContent = text.slice(match.start, match.end);
      span.dataset.lexipathWord = match.term;
      container.appendChild(span);

      lastIndex = match.end;
    }

    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  private renderAllWords(container: HTMLElement, text: string): void {
    const wordRegex = /[A-Za-z][A-Za-z'-]*/g;
    let lastIndex = 0;

    for (;;) {
      const match = wordRegex.exec(text);
      if (!match) break;

      const rawWord = match[0] ?? '';
      const normalizedWord = rawWord.toLowerCase();
      const startIndex = match.index;
      const endIndex = startIndex + rawWord.length;

      if (startIndex > lastIndex) {
        container.appendChild(document.createTextNode(text.slice(lastIndex, startIndex)));
      }

      const span = document.createElement('span');
      span.className = 'lexipath-subtitle-word';
      span.textContent = rawWord;
      span.dataset.lexipathWord = normalizedWord;
      container.appendChild(span);

      lastIndex = endIndex;
    }

    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  private normalizeTerm(term: string): string {
    const normalized = term
      .replace(/\u2019/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    return normalized;
  }

  private isAsciiWordChar(char: string | undefined): boolean {
    if (!char) return false;
    const code = char.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    return isDigit || isUpper || isLower;
  }

  private matchRespectsBoundary(
    normalizedText: string,
    start: number,
    end: number,
    term: string
  ): boolean {
    const first = term[0];
    const last = term[term.length - 1];

    if (this.isAsciiWordChar(first)) {
      const left = normalizedText[start - 1];
      if (this.isAsciiWordChar(left)) return false;
    }

    if (this.isAsciiWordChar(last)) {
      const right = normalizedText[end];
      if (this.isAsciiWordChar(right)) return false;
    }

    return true;
  }

  private findNonOverlappingTermMatches(
    text: string,
    normalizedTerms: string[]
  ): Array<{ start: number; end: number; term: string }> {
    const normalizedText = text.replace(/\u2019/g, "'").toLowerCase();
    const selected: Array<{ start: number; end: number; term: string }> = [];

    const terms = Array.from(new Set(normalizedTerms))
      .sort((a, b) => b.length - a.length || a.localeCompare(b));

    for (const term of terms) {
      if (!term) continue;
      const termLen = term.length;
      if (termLen === 0) continue;

      let fromIndex = 0;
      for (;;) {
        const start = normalizedText.indexOf(term, fromIndex);
        if (start === -1) break;
        const end = start + termLen;
        fromIndex = Math.max(end, start + 1);

        if (!this.matchRespectsBoundary(normalizedText, start, end, term)) continue;

        const overlaps = selected.some((range) => start < range.end && end > range.start);
        if (overlaps) continue;

        selected.push({ start, end, term });
      }
    }

    selected.sort((a, b) => a.start - b.start || b.end - a.end);
    return selected;
  }

  /**
   * Find video container element
   */
  private findVideoContainer(): HTMLElement | null {
    const selector = getVideoContainerSelector(this.platform);
    if (selector) {
      // Try multiple selectors for bilibili
      if (this.platform === 'bilibili') {
        const selectors = selector.split(', ');
        for (const sel of selectors) {
          const elem = document.querySelector(sel.trim());
          if (!(elem instanceof HTMLElement)) continue;
          return this.refineBilibiliVideoContainer(elem);
        }
      } else {
        const elem = document.querySelector(selector);
        if (elem instanceof HTMLElement) return elem;
      }
    }

    // Fallback for general web pages where no video player is targetted
    return document.body;
  }

  private refineBilibiliVideoContainer(container: HTMLElement): HTMLElement {
    const video = container.querySelector('video');
    if (!(video instanceof HTMLVideoElement)) return container;

    const preferred = video.closest('.bpx-player-video-area, .bpx-player-video-wrap, .bilibili-player-video-wrap');
    if (preferred instanceof HTMLElement) return preferred;

    return video.parentElement instanceof HTMLElement ? video.parentElement : container;
  }

  /**
   * Get Shadow DOM styles
   */
  private getStyles(): string {
    const isDark = this.theme === 'dark';
    const bgMain = isDark ? 'rgba(15, 23, 42, 0.95)' : 'rgba(255, 255, 255, 0.98)';
    const textMain = isDark ? '#ffffff' : '#1e293b';
    const textMuted = isDark ? 'rgba(226, 232, 240, 0.9)' : '#64748b';
    const borderMain = isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(226, 232, 240, 0.8)';
    const shadowMain = isDark ? '0 12px 28px rgba(0, 0, 0, 0.5)' : '0 12px 28px rgba(0, 0, 0, 0.1)';
    const btnBg = isDark ? 'rgba(15, 23, 42, 0.75)' : 'rgba(241, 245, 249, 0.9)';
    const btnText = isDark ? 'rgba(248, 250, 252, 0.95)' : '#475569';
    const btnBorder = isDark ? 'rgba(148, 163, 184, 0.35)' : 'rgba(203, 213, 225, 0.5)';

    return `
        .lexipath-subtitle {
          display: none;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          max-width: 90%;
          padding: 0;
          background: transparent;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          font-size: var(--lexipath-subtitle-font-size, 20px);
          line-height: 1.4;
          color: #ffffff;
          text-align: center;
          text-shadow:
            0 0 2px rgba(0, 0, 0, 0.95),
            0 0 8px rgba(0, 0, 0, 0.6),
            1px 0 0 rgba(0, 0, 0, 0.9),
            -1px 0 0 rgba(0, 0, 0, 0.9),
            0 1px 0 rgba(0, 0, 0, 0.9),
            0 -1px 0 rgba(0, 0, 0, 0.9),
            1px 1px 0 rgba(0, 0, 0, 0.85),
            -1px 1px 0 rgba(0, 0, 0, 0.85),
            1px -1px 0 rgba(0, 0, 0, 0.85),
            -1px -1px 0 rgba(0, 0, 0, 0.85);
          transition: opacity 0.2s ease;
        }

        .lexipath-subtitle.visible {
          display: flex;
        }

        .lexipath-subtitle__controls {
          display: flex;
          justify-content: flex-end;
          width: 100%;
          margin-bottom: 2px;
        }

        .lexipath-subtitle__mode-toggle {
          pointer-events: auto;
          cursor: pointer;
          font-size: 12px;
          line-height: 1;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid ${btnBorder};
          background: ${btnBg};
          color: ${btnText};
          transition: all 0.2s ease;
        }

        .lexipath-subtitle__mode-toggle:hover {
          background: ${isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(226, 232, 240, 1)'};
          border-color: ${isDark ? 'rgba(148, 163, 184, 0.55)' : 'rgba(148, 163, 184, 0.5)'};
        }

        .lexipath-subtitle__lines {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .line-enhanced {
          font-weight: 600;
          color: #ffffff;
        }

        .line-original {
          font-size: var(--lexipath-subtitle-original-font-size, 16px);
          font-weight: 400;
          color: #cccccc;
          opacity: 0.9;
        }

        .lexipath-subtitle:hover {
          opacity: 0.95;
        }

        .lexipath-subtitle-word {
          border-bottom: 2px dotted rgba(59, 130, 246, 0.9);
          cursor: pointer;
          padding: 0 1px;
        }

        .lexipath-subtitle-word:hover {
          background: rgba(59, 130, 246, 0.22);
          border-radius: 3px;
        }

        .lexipath-wordcard {
          display: none;
          position: fixed;
          width: 320px;
          max-width: calc(100vw - 20px);
          z-index: 10001;
          pointer-events: auto;
          background: ${bgMain};
          color: ${textMain};
          border: 1px solid ${borderMain};
          box-shadow: ${shadowMain};
          border-radius: 12px;
          backdrop-filter: blur(8px);
          padding: 12px;
        }

        .lexipath-wordcard.visible {
          display: block;
        }

        .lexipath-wordcard__header {
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-bottom: 10px;
        }

        .lexipath-wordcard__title {
          font-size: 18px;
          font-weight: 700;
          line-height: 1.2;
        }

        .lexipath-wordcard__meta {
          font-size: 12px;
          color: ${textMuted};
        }

        .lexipath-wordcard__body {
          display: flex;
          flex-direction: column;
          gap: 8px;
          font-size: 13px;
          line-height: 1.45;
          color: ${isDark ? 'rgba(241, 245, 249, 0.95)' : '#334155'};
        }

        .lexipath-wordcard__definition {
          font-size: 13px;
        }

        .lexipath-wordcard__example {
          padding-top: 8px;
          border-top: 1px solid ${isDark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(226, 232, 240, 0.8)'};
          font-style: italic;
          color: ${isDark ? 'rgba(226, 232, 240, 0.95)' : '#475569'};
        }

        .lexipath-wordcard__example-translation {
          color: ${isDark ? 'rgba(148, 163, 184, 0.95)' : '#64748b'};
        }

        .lexipath-wordcard__footer {
          margin-top: 14px;
          padding-top: 10px;
          border-top: 1px solid ${isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(226, 232, 240, 0.5)'};
          display: flex;
          justify-content: flex-end;
        }

        .lexipath-wordcard__chat-button {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 8px;
          border: 1px solid rgba(99, 102, 241, 0.3);
          background: rgba(99, 102, 241, 0.1);
          color: #818cf8;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .lexipath-wordcard__chat-button:hover {
          background: rgba(99, 102, 241, 0.2);
          border-color: rgba(99, 102, 241, 0.5);
          transform: translateY(-1px);
        }

        .lexipath-wordcard__chat-button svg {
          stroke: currentColor;
        }
    `;
  }
}

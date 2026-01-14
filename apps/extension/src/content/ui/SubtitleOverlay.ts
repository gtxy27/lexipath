/**
 * Subtitle Overlay Component
 *
 * Renders subtitles using Shadow DOM for style isolation.
 * Supports both overlay (on video) and below-video positioning.
 */

import { getI18nMessage } from '../i18n';
import { sendMessage } from '../../shared/messages';
import { createLogger, getErrorMessage } from '@lexipath/core/log';
import { speak, stop } from '@lexipath/dictionary';

const log = createLogger('subtitle-overlay');

export type SubtitleMode = 'enhanced' | 'bilingual' | 'bilingual-temp';

export interface SubtitleLine {
  text: string;
  isEnhanced: boolean; // true for enhanced line, false for original
}

export interface SubtitleDisplayOptions {
  mode: SubtitleMode;
  lines: SubtitleLine[];
  interactiveWords?: Set<string>;
  keywordTranslations?: Record<string, string>;
  showKeywordTranslations?: boolean;
  modeLabels?: { enhanced?: string; bilingual?: string; bilingualTemp?: string };
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

export type WordCardSectionKey = 'definition' | 'translation' | 'example' | 'exampleTranslation';

export interface WordCardConfig {
  sectionsOrder?: WordCardSectionKey[];
  autoPronounce?: boolean;
  ttsLang?: string;
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
  private modeLabels: Partial<Record<SubtitleMode, string>> = {};
  private onModeChange?: (mode: SubtitleMode) => void;
  private onWordClick?: (word: string, anchorRect: DOMRect) => void;
  private onWordHover?: (word: string, anchorRect: DOMRect) => void;
  private layout: 'default' | 'youtube-shorts' = 'default';
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
  private keywordTranslationLayoutRaf: number | null = null;
  private wordCardConfig: WordCardConfig = {
    sectionsOrder: ['definition', 'translation', 'example', 'exampleTranslation'],
    autoPronounce: true,
    ttsLang: 'en-US',
  };
  private wordCardLastWord: string | null = null;
  private wordCardTempTtsLang: string | null = null;
  private wordCardSpeakToken = 0;
  private lastDisplayLines: SubtitleLine[] = [];

  constructor(
    platform: 'youtube' | 'bilibili',
    options?: {
      theme?: 'light' | 'dark';
      layout?: 'default' | 'youtube-shorts';
      onModeChange?: (mode: SubtitleMode) => void;
      onWordClick?: (word: string, anchorRect: DOMRect) => void;
      onWordHover?: (word: string, anchorRect: DOMRect) => void;
    }
  ) {
    this.platform = platform;
    this.theme = options?.theme === 'light' ? 'light' : 'dark';
    this.layout = options?.layout === 'youtube-shorts' ? 'youtube-shorts' : 'default';
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
      log.warn('Already mounted');
      return true;
    }

    const videoContainer = this.findVideoContainer();
    if (!videoContainer) {
      log.error('Video container not found');
      return false;
    }
    this.videoContainer = videoContainer;
    this.ensureVideoContainerPositioned();

    const layout = this.layout;
    const containerBottomPx = layout === 'youtube-shorts' ? 110 : 60;
    const containerPaddingX = layout === 'youtube-shorts' ? 10 : 0;

    // Create container
    this.container = document.createElement('div');
    this.container.id = 'lexipath-subtitle-overlay';
    this.container.style.cssText = `
      position: absolute;
      bottom: ${containerBottomPx}px;
      left: 0;
      right: 0;
      pointer-events: none;
      z-index: 10000;
      display: flex;
      justify-content: center;
      align-items: flex-end;
      padding: 0 ${containerPaddingX}px;
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

    log.info('Mounted successfully');
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
    } catch (error: unknown) {
      log.debug('getComputedStyle threw while positioning video container; skipping positioning', { message: getErrorMessage(error) });
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
      log.warn('Not mounted');
      return;
    }

    if (options.modeLabels) {
      this.setModeLabels(options.modeLabels);
    }

    this.mode = options.mode;
    const { lines } = options;
    this.lastDisplayLines = Array.isArray(lines) ? lines.map((line) => ({ ...line })) : [];
    this.updateModeLabel();

    if (lines.length === 0) {
      this.clear();
      return;
    }

    this.subtitleLinesElement.textContent = '';
    for (const line of lines) {
      const div = document.createElement('div');
      div.className = line.isEnhanced ? 'line-enhanced' : 'line-original';
      this.renderLineWithWordSpans(
        div,
        line.text,
        options.interactiveWords,
        options.keywordTranslations,
        options.showKeywordTranslations ?? false
      );
      this.subtitleLinesElement.appendChild(div);
    }

    if (options.showKeywordTranslations) {
      this.scheduleKeywordTranslationPlacement();
    }
    this.subtitleElement.classList.add('visible');
  }

  private getVideoTitle(): string {
    const title = typeof document?.title === 'string' ? document.title.trim() : '';
    if (!title) return '';
    return title.replace(/\s+-\s+YouTube\s*$/i, '').trim();
  }

  private getVideoTimestampSec(): number | null {
    const container = this.videoContainer;
    if (!container) return null;
    const video = container.querySelector('video');
    if (!(video instanceof HTMLVideoElement)) return null;
    const t = typeof video.currentTime === 'number' ? video.currentTime : NaN;
    if (!Number.isFinite(t) || t < 0) return null;
    return t;
  }

  private getSubtitleContextLines(): string[] {
    const raw = (this.lastDisplayLines ?? []).map((l) => String(l.text ?? '').trim()).filter(Boolean);
    return raw.slice(0, 4).map((line) => (line.length > 240 ? `${line.slice(0, 240)}…` : line));
  }

  /**
   * Clear subtitle display
   */
  clear(): void {
    if (!this.subtitleElement || !this.subtitleLinesElement) return;
    this.subtitleLinesElement.textContent = '';
    this.subtitleElement.classList.remove('visible');
    this.hideWordCard();
    if (this.keywordTranslationLayoutRaf !== null) {
      window.cancelAnimationFrame(this.keywordTranslationLayoutRaf);
      this.keywordTranslationLayoutRaf = null;
    }
  }

  private scheduleKeywordTranslationPlacement(): void {
    if (!this.subtitleLinesElement) return;
    if (this.keywordTranslationLayoutRaf !== null) {
      window.cancelAnimationFrame(this.keywordTranslationLayoutRaf);
    }
    this.keywordTranslationLayoutRaf = window.requestAnimationFrame(() => {
      this.keywordTranslationLayoutRaf = null;
      this.updateKeywordTranslationPlacement();
    });
  }

  private updateKeywordTranslationPlacement(): void {
    if (!this.subtitleLinesElement) return;

    const lineEls = Array.from(this.subtitleLinesElement.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement
    );

    for (const lineEl of lineEls) {
      const lineTop = lineEl.getBoundingClientRect().top;
      const wordEls = Array.from(lineEl.querySelectorAll<HTMLElement>('.lexipath-subtitle-word'));
      for (const wordEl of wordEls) {
        const hasTranslation = Boolean(wordEl.querySelector('.lexipath-subtitle-word__translation'));
        if (!hasTranslation) {
          wordEl.classList.remove('lexipath-subtitle-word--below');
          continue;
        }

        const rect = wordEl.getBoundingClientRect();
        // If the word wrapped onto a lower visual row, place the gloss below to avoid colliding with the row above.
        const isWrappedRow = rect.top - lineTop > 6;
        wordEl.classList.toggle('lexipath-subtitle-word--below', isWrappedRow);
      }
    }
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

  getMode(): SubtitleMode {
    return this.mode;
  }

  setMode(mode: SubtitleMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.updateModeLabel();
  }

  /**
   * Handle click to toggle mode
   */
  private handleClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement | null;
    const wordEl = target?.closest?.('[data-lexipath-word]') as HTMLElement | null;
    const word = wordEl?.dataset?.lexipathWord;
    if (wordEl && word && this.onWordClick) {
      event.stopPropagation();
      const rect = wordEl.getBoundingClientRect();
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
    const override = this.modeLabels[mode];
    if (typeof override === 'string' && override.trim()) return override;

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

  setModeLabels(labels: { enhanced?: string; bilingual?: string; bilingualTemp?: string }): void {
    const next: Partial<Record<SubtitleMode, string>> = {};
    if (labels.enhanced) next.enhanced = labels.enhanced;
    if (labels.bilingual) next.bilingual = labels.bilingual;
    if (labels.bilingualTemp) next['bilingual-temp'] = labels.bilingualTemp;
    this.modeLabels = next;
    this.updateModeLabel();
  }

  setWordCardConfig(config: WordCardConfig): void {
    this.wordCardConfig = {
      ...this.wordCardConfig,
      ...config,
    };
  }

  private getWordCardSectionsOrder(): WordCardSectionKey[] {
    const all: WordCardSectionKey[] = ['definition', 'translation', 'example', 'exampleTranslation'];
    const raw = this.wordCardConfig.sectionsOrder ?? all;
    const seen = new Set<WordCardSectionKey>();
    const next: WordCardSectionKey[] = [];
    for (const item of raw) {
      if (!all.includes(item)) continue;
      if (seen.has(item)) continue;
      seen.add(item);
      next.push(item);
    }
    for (const item of all) {
      if (seen.has(item)) continue;
      next.push(item);
    }
    return next;
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

    if (this.wordCardLastWord !== data.word) {
      this.wordCardTempTtsLang = null;
      this.wordCardLastWord = data.word;
    }

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

    if (metaParts.length > 0) {
      const meta = document.createElement('div');
      meta.className = 'lexipath-wordcard__meta';
      meta.textContent = metaParts.join(' · ');
      header.appendChild(meta);
    }

    const body = document.createElement('div');
    body.className = 'lexipath-wordcard__body';

    const sectionsByKey: Partial<Record<WordCardSectionKey, HTMLElement>> = {};

    const definition = document.createElement('div');
    definition.className = 'lexipath-wordcard__section lexipath-wordcard__definition';
    definition.innerHTML = `
      <div class="lexipath-wordcard__section-label">${getI18nMessage('wordCard_sectionDefinition')}</div>
      <div class="lexipath-wordcard__section-text"></div>
    `;
    const defText = definition.querySelector('.lexipath-wordcard__section-text');
    if (defText) defText.textContent = data.definition;
    sectionsByKey.definition = definition;

    if (data.translation) {
      const translation = document.createElement('div');
      translation.className = 'lexipath-wordcard__section lexipath-wordcard__translation';
      translation.innerHTML = `
        <div class="lexipath-wordcard__section-label">${getI18nMessage('wordCard_sectionTranslation')}</div>
        <div class="lexipath-wordcard__section-text"></div>
      `;
      const trText = translation.querySelector('.lexipath-wordcard__section-text');
      if (trText) trText.textContent = data.translation;
      sectionsByKey.translation = translation;
    }

    if (data.example) {
      const example = document.createElement('div');
      example.className = 'lexipath-wordcard__section lexipath-wordcard__example';
      example.innerHTML = `
        <div class="lexipath-wordcard__section-label">${getI18nMessage('wordCard_sectionExample')}</div>
        <div class="lexipath-wordcard__section-text"></div>
      `;
      const exText = example.querySelector('.lexipath-wordcard__section-text');
      if (exText) exText.textContent = data.example;
      sectionsByKey.example = example;
    }

    if (data.exampleTranslation) {
      const exampleTranslation = document.createElement('div');
      exampleTranslation.className = 'lexipath-wordcard__section lexipath-wordcard__example-translation';
      exampleTranslation.innerHTML = `
        <div class="lexipath-wordcard__section-label">${getI18nMessage('wordCard_sectionExampleTranslation')}</div>
        <div class="lexipath-wordcard__section-text"></div>
      `;
      const exTrText = exampleTranslation.querySelector('.lexipath-wordcard__section-text');
      if (exTrText) exTrText.textContent = data.exampleTranslation;
      sectionsByKey.exampleTranslation = exampleTranslation;
    }

    for (const key of this.getWordCardSectionsOrder()) {
      const el = sectionsByKey[key];
      if (!el) continue;
      body.appendChild(el);
    }

    this.wordCardElement.appendChild(header);
    this.wordCardElement.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'lexipath-wordcard__footer';

    const actionRow = document.createElement('div');
    actionRow.className = 'lexipath-wordcard__actions';

    const pronounceButton = document.createElement('button');
    pronounceButton.type = 'button';
    pronounceButton.className = 'lexipath-wordcard__pronounce-button';
    pronounceButton.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
      </svg>
      <span>${getI18nMessage('wordCard_pronounce') || 'Pronounce'}</span>
    `;

    const setPronounceButtonSpeaking = (speaking: boolean) => {
      pronounceButton.classList.toggle('is-speaking', speaking);
      pronounceButton.setAttribute('aria-pressed', speaking ? 'true' : 'false');
    };

    const resolveEffectiveTtsLang = (): string => {
      const base = this.wordCardConfig.ttsLang ?? 'en-US';
      return this.wordCardTempTtsLang ?? base;
    };

    const shouldShowAccentToggle = () => {
      const base = this.wordCardConfig.ttsLang ?? '';
      const effective = this.wordCardTempTtsLang ?? base;
      return (
        typeof effective === 'string' &&
        (effective.toLowerCase() === 'en-us' || effective.toLowerCase() === 'en-gb')
      );
    };

    const accentToggle = document.createElement('button');
    accentToggle.type = 'button';
    accentToggle.className = 'lexipath-wordcard__accent-toggle';

    const updateAccentToggleLabel = () => {
      const lang = resolveEffectiveTtsLang().toLowerCase();
      accentToggle.textContent = lang === 'en-gb' ? 'UK' : 'US';
    };
    updateAccentToggleLabel();

    accentToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = resolveEffectiveTtsLang().toLowerCase();
      this.wordCardTempTtsLang = current === 'en-us' ? 'en-GB' : 'en-US';
      updateAccentToggleLabel();
    });

    if (shouldShowAccentToggle()) {
      actionRow.appendChild(accentToggle);
    }

    pronounceButton.addEventListener('click', async (e) => {
      e.stopPropagation();

      if (pronounceButton.classList.contains('is-speaking')) {
        stop();
        setPronounceButtonSpeaking(false);
        return;
      }

      const token = ++this.wordCardSpeakToken;
      setPronounceButtonSpeaking(true);
      try {
        await speak(data.word, resolveEffectiveTtsLang());
      } catch (error: unknown) {
        log.debug('Word card TTS failed', { message: getErrorMessage(error) });
      } finally {
        if (token === this.wordCardSpeakToken) {
          setPronounceButtonSpeaking(false);
        }
      }
    });

    actionRow.appendChild(pronounceButton);
    footer.appendChild(actionRow);

    const chatButton = document.createElement('button');
    chatButton.className = 'lexipath-wordcard__chat-button';
    chatButton.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6 6-6"/></svg>
      <span>${getI18nMessage('wordCard_askAI') || 'Ask AI'}</span>
    `;
    chatButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const prompt = `Please explain the usage of the word "${data.word}" in this context${data.example ? `: "${data.example}"` : ''}.`;
      const title = this.getVideoTitle();
      const timestampSec = this.getVideoTimestampSec();
      const lines = this.getSubtitleContextLines();

      sendMessage('OPEN_SIDEBAR', {
        initialMessage: prompt,
        keyword: data.word,
        isAutoSend: true,
        contextInfo: {
          kind: 'subtitle',
          platform: this.platform,
          ...(title ? { title } : {}),
          ...(typeof timestampSec === 'number' ? { timestampSec } : {}),
          ...(lines.length ? { lines } : {}),
        },
      });
      this.hideWordCard();
    });
    footer.appendChild(chatButton);
    this.wordCardElement.appendChild(footer);

    const loadingText = getI18nMessage('wordCard_loading', undefined, getI18nMessage('loading'));
    const shouldAutoPronounce = Boolean(options?.pinned) && Boolean(this.wordCardConfig.autoPronounce);
    if (shouldAutoPronounce && data.definition !== loadingText) {
      // Avoid overlapping audio when flipping from loading -> resolved card.
      stop();
      const token = ++this.wordCardSpeakToken;
      setPronounceButtonSpeaking(true);
      void speak(data.word, resolveEffectiveTtsLang())
        .catch((error: unknown) => {
          log.debug('Word card auto TTS failed', { message: getErrorMessage(error) });
        })
        .finally(() => {
          if (token === this.wordCardSpeakToken) {
            setPronounceButtonSpeaking(false);
          }
        });
    }

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
    this.wordCardSpeakToken++;
    stop();
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

  private renderLineWithWordSpans(
    container: HTMLElement,
    text: string,
    interactiveWords?: Set<string>,
    keywordTranslations?: Record<string, string>,
    showKeywordTranslations: boolean = false
  ): void {
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

      const wordText = text.slice(match.start, match.end);
      const wordEl = document.createElement('span');
      wordEl.className = 'lexipath-subtitle-word__text';
      wordEl.textContent = wordText;
      span.appendChild(wordEl);

      const translationRaw = showKeywordTranslations ? keywordTranslations?.[match.term] : undefined;
      const translation = typeof translationRaw === 'string' ? translationRaw.trim() : '';
      if (translation && translation.toLowerCase() !== match.term.toLowerCase()) {
        const sup = document.createElement('sup');
        sup.className = 'lexipath-subtitle-word__translation';
        sup.textContent = translation;
        span.appendChild(sup);
      }

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
          position: relative;
          display: inline-block;
          border-bottom: 2px dotted rgba(59, 130, 246, 0.9);
          cursor: pointer;
          padding: 0 1px;
        }

        .lexipath-subtitle-word:hover {
          background: rgba(59, 130, 246, 0.22);
          border-radius: 3px;
        }

        .lexipath-subtitle-word__translation {
          pointer-events: none;
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          top: -0.95em;
          font-size: 0.62em;
          line-height: 1;
          opacity: 0.85;
          white-space: nowrap;
          color: ${isDark ? 'rgba(226, 232, 240, 0.9)' : '#334155'};
        }

        .lexipath-subtitle-word--below .lexipath-subtitle-word__translation {
          top: auto;
          bottom: -0.95em;
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

	        @media (pointer: coarse) {
	          .lexipath-wordcard {
            position: fixed !important;
            bottom: 0 !important;
            left: 0 !important;
            top: auto !important;
            width: 100% !important;
            max-width: 100% !important;
            border-radius: 20px 20px 0 0 !important;
            padding: 24px 20px 40px 20px !important;
            border-left: none !important;
            border-right: none !important;
            border-bottom: none !important;
            transform: translateY(0) !important;
            box-shadow: 0 -10px 40px rgba(0,0,0,0.4) !important;
            animation: slideUp 0.3s ease-out;
          }

	          .lexipath-wordcard__chat-button {
	            width: 100%;
	            height: 48px;
	            justify-content: center;
	            font-size: 13px;
	          }

	          .lexipath-wordcard__footer {
	            flex-direction: column;
	            align-items: stretch;
	            gap: 10px;
	          }

	          .lexipath-wordcard__actions {
	            width: 100%;
	          }

	          .lexipath-wordcard__pronounce-button {
	            flex: 1;
	            height: 48px;
	            justify-content: center;
	            font-size: 13px;
	          }

	          .lexipath-subtitle-word {
	            padding: 2px 4px !important;
	            border-bottom-width: 3px !important;
	          }
	        }

        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
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
	          gap: 10px;
	          font-size: 13px;
	          line-height: 1.45;
	          color: ${isDark ? 'rgba(241, 245, 249, 0.95)' : '#334155'};
	        }

	        .lexipath-wordcard__section {
	          display: flex;
	          flex-direction: column;
	          gap: 4px;
	        }

	        .lexipath-wordcard__section-label {
	          font-size: 10px;
	          font-weight: 800;
	          text-transform: uppercase;
	          letter-spacing: 0.10em;
	          color: ${textMuted};
	        }

	        .lexipath-wordcard__section-text {
	          font-size: 13px;
	          white-space: pre-line;
	        }

	        .lexipath-wordcard__example {
	          padding-top: 8px;
	          border-top: 1px solid ${isDark ? 'rgba(148, 163, 184, 0.22)' : 'rgba(226, 232, 240, 0.8)'};
	        }

	        .lexipath-wordcard__example .lexipath-wordcard__section-text {
	          font-style: italic;
	          color: ${isDark ? 'rgba(226, 232, 240, 0.95)' : '#475569'};
	        }

	        .lexipath-wordcard__example-translation {
	          color: ${textMuted};
	        }

	        .lexipath-wordcard__example-translation .lexipath-wordcard__section-text {
	          color: ${isDark ? 'rgba(148, 163, 184, 0.95)' : '#64748b'};
	        }

	        .lexipath-wordcard__footer {
	          margin-top: 14px;
	          padding-top: 10px;
	          border-top: 1px solid ${isDark ? 'rgba(148, 163, 184, 0.15)' : 'rgba(226, 232, 240, 0.5)'};
	          display: flex;
	          align-items: center;
	          justify-content: space-between;
	          gap: 10px;
	          flex-wrap: wrap;
	        }

	        .lexipath-wordcard__actions {
	          display: flex;
	          align-items: center;
	          gap: 8px;
	          flex: 1;
	          min-width: 0;
	        }

	        .lexipath-wordcard__pronounce-button {
	          display: inline-flex;
	          align-items: center;
	          gap: 6px;
	          padding: 6px 10px;
	          border-radius: 10px;
	          border: 1px solid ${isDark ? 'rgba(148, 163, 184, 0.30)' : 'rgba(203, 213, 225, 0.65)'};
	          background: ${isDark ? 'rgba(15, 23, 42, 0.55)' : 'rgba(241, 245, 249, 0.9)'};
	          color: ${btnText};
	          font-size: 11px;
	          font-weight: 800;
	          text-transform: uppercase;
	          letter-spacing: 0.05em;
	          cursor: pointer;
	          transition: all 0.2s ease;
	          user-select: none;
	        }

	        .lexipath-wordcard__pronounce-button:hover {
	          background: ${isDark ? 'rgba(15, 23, 42, 0.72)' : 'rgba(226, 232, 240, 0.95)'};
	          transform: translateY(-1px);
	        }

	        .lexipath-wordcard__pronounce-button.is-speaking {
	          border-color: rgba(99, 102, 241, 0.55);
	          color: ${isDark ? '#a5b4fc' : '#4f46e5'};
	        }

	        .lexipath-wordcard__accent-toggle {
	          height: 28px;
	          min-width: 44px;
	          padding: 0 10px;
	          border-radius: 999px;
	          border: 1px solid rgba(99, 102, 241, 0.35);
	          background: rgba(99, 102, 241, 0.08);
	          color: ${isDark ? '#a5b4fc' : '#4f46e5'};
	          font-size: 10px;
	          font-weight: 900;
	          letter-spacing: 0.08em;
	          cursor: pointer;
	          user-select: none;
	          transition: all 0.2s ease;
	        }

	        .lexipath-wordcard__accent-toggle:hover {
	          background: rgba(99, 102, 241, 0.14);
	          border-color: rgba(99, 102, 241, 0.55);
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

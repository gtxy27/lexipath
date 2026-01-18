import { getI18nMessage } from '../i18n';
import { sendMessage } from '../../shared/messages';
import { createLogger, getErrorMessage } from '@lexipath/core/log';
import { makeWordbookEntryId, normalizeWordbookLanguage, normalizeWordbookTerm } from '@lexipath/core';
import { speak, stop } from '@lexipath/dictionary';
import { makeSubtitleAnchorKey, makeWebAnchorKey } from '../../shared/chat-anchor';

import type { WordCardData, WordCardConfig, WordCardSectionKey } from './SubtitleOverlay';

type SubtitlePlatform = 'youtube' | 'bilibili';

type ContextInfo = {
  kind: 'subtitle';
  platform?: string;
  title?: string;
  timestampSec?: number;
  lines?: string[];
  // Used for stable session grouping without storing raw IDs.
  anchorId?: string;
  url?: string;
};

const log = createLogger('subtitle-wordcard-controller'); 

export class WordCardController {
  private wordCardElement: HTMLDivElement;
  private container: HTMLDivElement;
  private platform: SubtitlePlatform;

  private wordCardVisible = false;
  private wordCardPinned = false;
  private documentClickListenerAttached = false;

  private hoverWord: string | null = null;
  private hoverRect: DOMRect | null = null;
  private hoverOpenTimer: number | null = null;
  private hoverCloseTimer: number | null = null;
  private readonly hoverOpenDelayMs = 250;
  private readonly hoverCloseDelayMs = 250;

  private wordCardConfig: WordCardConfig;
  private wordCardLastWord: string | null = null;
  private wordCardTempTtsLang: string | null = null;
  private wordCardSpeakToken = 0;
  private wordCardWordbookToken = 0;

  private onWordClick: ((word: string, anchorRect: DOMRect) => void) | undefined;
  private onWordHover: ((word: string, anchorRect: DOMRect) => void) | undefined;

  private getVideoTitle: () => string;
  private getVideoTimestampSec: () => number | null;
  private getSubtitleContextLines: () => string[];
  private getSubtitleAnchorId: () => string = () => '';


  constructor(options: { 
    container: HTMLDivElement; 
    wordCardElement: HTMLDivElement; 
    platform: SubtitlePlatform;
    wordCardConfig: WordCardConfig;
    onWordClick: ((word: string, anchorRect: DOMRect) => void) | undefined;
    onWordHover: ((word: string, anchorRect: DOMRect) => void) | undefined;
    getVideoTitle: () => string;
    getVideoTimestampSec: () => number | null;
    getSubtitleContextLines: () => string[];
    getSubtitleAnchorId: () => string;
  }) { 
    this.container = options.container; 
    this.wordCardElement = options.wordCardElement; 
    this.wordCardElement.setAttribute('data-lx-wordcard', 'subtitle'); 
    this.platform = options.platform; 
    this.wordCardConfig = options.wordCardConfig; 
    this.onWordClick = options.onWordClick; 
    this.onWordHover = options.onWordHover; 
    this.getVideoTitle = options.getVideoTitle;
    this.getVideoTimestampSec = options.getVideoTimestampSec;
    this.getSubtitleContextLines = options.getSubtitleContextLines;
    this.getSubtitleAnchorId = options.getSubtitleAnchorId;
  }

  destroy(): void {
    this.clearHoverTimers();
    this.detachDocumentClickListener();
    this.wordCardSpeakToken++;
    stop();
  }

  setWordCardConfig(config: WordCardConfig): void {
    this.wordCardConfig = {
      ...this.wordCardConfig,
      ...config,
    };
  }

  showWordCardLoading(word: string, anchorRect: DOMRect, options?: { pinned?: boolean }): void {
    const loadingText = getI18nMessage('wordCard_loading', undefined, getI18nMessage('loading'));
    this.showWordCard(
      {
        word,
        definition: loadingText,
      },
      anchorRect,
      options,
    );
  }

  showWordCard(data: WordCardData, anchorRect: DOMRect, options?: { pinned?: boolean }): void {
    if (this.wordCardLastWord !== data.word) {
      this.wordCardTempTtsLang = null;
      this.wordCardLastWord = data.word;
    }

    this.wordCardPinned = options?.pinned ?? this.wordCardPinned;
    this.wordCardElement.textContent = '';

    const header = document.createElement('div');
    header.className = 'lexipath-wordcard__header';

    const titleRow = document.createElement('div');
    titleRow.className = 'lexipath-wordcard__title-row';

    const title = document.createElement('div');
    title.className = 'lexipath-wordcard__title';
    title.textContent = data.word;
    titleRow.appendChild(title);

    const wordbookStateBadge = document.createElement('span');
    wordbookStateBadge.className = 'lexipath-wordcard__wordbook-state';
    wordbookStateBadge.style.display = 'none';
    titleRow.appendChild(wordbookStateBadge);

    header.appendChild(titleRow);

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

    const wordbookButton = document.createElement('button'); 
    wordbookButton.type = 'button'; 
    wordbookButton.className = 'lexipath-wordcard__wordbook-button'; 
    wordbookButton.disabled = true; 
    wordbookButton.innerHTML = ` 
      <svg class="lexipath-wordcard__wordbook-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"> 
        <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a.53.53 0 0 0 .398.29l5.166.75a.53.53 0 0 1 .294.904l-3.737 3.644a.53.53 0 0 0-.153.469l.882 5.143a.53.53 0 0 1-.77.56l-4.618-2.427a.53.53 0 0 0-.494 0l-4.618 2.427a.53.53 0 0 1-.77-.56l.882-5.143a.53.53 0 0 0-.153-.469L3.257 8.918a.53.53 0 0 1 .294-.904l5.166-.75a.53.53 0 0 0 .398-.29z"/> 
      </svg> 
    `; 
    wordbookButton.setAttribute('aria-label', getI18nMessage('wordCard_save') || 'Save'); 
    actionRow.appendChild(wordbookButton); 
 
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
      const anchorId = this.getSubtitleAnchorId();

      const contextInfo: ContextInfo = {
        kind: 'subtitle',
        platform: this.platform,
        ...(title ? { title } : {}),
        ...(typeof timestampSec === 'number' ? { timestampSec } : {}),
        ...(lines.length ? { lines } : {}),
        ...(anchorId ? { anchorId } : {}),
        url: window.location.href,
      };

      sendMessage('OPEN_SIDEBAR', {
        initialMessage: prompt,
        keyword: data.word,
        isAutoSend: true,
        contextInfo,
      });

      this.hideWordCard();
    });

    footer.appendChild(chatButton);
    this.wordCardElement.appendChild(footer);

    const setWordbookUi = (state: 'active' | 'archived' | 'ignored' | null) => { 
      const saved = Boolean(state); 
      wordbookButton.setAttribute( 
        'aria-label', 
        saved ? getI18nMessage('wordCard_unsave') || 'Unsave' : getI18nMessage('wordCard_save') || 'Save', 
      ); 
      wordbookButton.classList.toggle('is-saved', saved); 
 
      if (!saved) { 
        wordbookStateBadge.style.display = 'none'; 
        wordbookStateBadge.textContent = ''; 
        wordbookStateBadge.removeAttribute('data-state'); 
        return;
      }

      const labelKey =
        state === 'archived'
          ? 'wordCard_stateArchived'
          : state === 'ignored'
            ? 'wordCard_stateIgnored'
            : 'wordCard_stateActive';
      wordbookStateBadge.textContent = getI18nMessage(labelKey) || state;
      wordbookStateBadge.setAttribute('data-state', state ?? '');
      wordbookStateBadge.style.display = '';
    };

    const resolveWordbookIdentity = async (): Promise<{
      id: string;
      language: string;
      term: string;
      normalizedTerm: string;
    } | null> => {
      const term = String(data.word ?? '').trim();
      const normalizedTerm = normalizeWordbookTerm(term);
      if (!normalizedTerm) return null;

      try {
        const resp = await sendMessage('GET_SETTINGS', undefined);
        const language = normalizeWordbookLanguage(resp.ok ? (resp.value as any)?.targetLanguage : undefined);
        const id = makeWordbookEntryId(language as any, normalizedTerm);
        return { id, language, term, normalizedTerm };
      } catch {
        const language = normalizeWordbookLanguage(undefined);
        const id = makeWordbookEntryId(language as any, normalizedTerm);
        return { id, language, term, normalizedTerm };
      }
    };

    const resolveWordbookSource = async (): Promise<any | null> => {
      const now = Date.now();
      const snippet = (() => {
        const candidate =
          (typeof data.example === 'string' && data.example.trim() ? data.example.trim() : '') ||
          this.getSubtitleContextLines().join(' ');
        const trimmed = String(candidate ?? '').trim();
        if (!trimmed) return undefined;
        return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
      })();

      const anchorId = this.getSubtitleAnchorId();
      if (anchorId) {
        const anchorKey = await makeSubtitleAnchorKey(anchorId);
        if (anchorKey) {
          const timestampSec = this.getVideoTimestampSec();
          return {
            kind: 'subtitle',
            anchorKey,
            capturedAt: now,
            ...(snippet ? { snippet } : {}),
            platform: this.platform,
            ...(typeof timestampSec === 'number' ? { timestampSec: Math.floor(timestampSec) } : {}),
          };
        }
      }

      const anchorKey = await makeWebAnchorKey(window.location.href);
      if (!anchorKey) return null;
      return {
        kind: 'web',
        anchorKey,
        capturedAt: now,
        ...(snippet ? { snippet } : {}),
        domain: window.location.hostname,
        title: document.title,
      };
    };

    const refreshWordbookState = async () => {
      const token = ++this.wordCardWordbookToken;
      wordbookButton.disabled = true;
      try {
        const identity = await resolveWordbookIdentity();
        if (!identity) return;
        const resp = await sendMessage('WORDBOOK_GET', { id: identity.id } as any);
        if (token !== this.wordCardWordbookToken) return;
        if (!resp.ok) {
          setWordbookUi(null);
          return;
        }
        const entry = resp.value as any;
        setWordbookUi(entry?.state ?? null);
      } catch {
        if (token !== this.wordCardWordbookToken) return;
        setWordbookUi(null);
      } finally {
        if (token === this.wordCardWordbookToken) {
          wordbookButton.disabled = false;
        }
      }
    };

    wordbookButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      const token = ++this.wordCardWordbookToken;
      wordbookButton.disabled = true;

      try {
        const identity = await resolveWordbookIdentity();
        if (!identity) return;

        const existing = await sendMessage('WORDBOOK_GET', { id: identity.id } as any);
        if (token !== this.wordCardWordbookToken) return;

        if (existing.ok && existing.value) {
          await sendMessage('WORDBOOK_DELETE', { id: identity.id } as any);
          if (token !== this.wordCardWordbookToken) return;
          setWordbookUi(null);
          return;
        }

        const source = await resolveWordbookSource();
        if (token !== this.wordCardWordbookToken) return;

        const now = Date.now();
        const entry = {
          id: identity.id,
          language: identity.language,
          term: identity.term,
          normalizedTerm: identity.normalizedTerm,
          state: 'active',
          tags: [],
          note: '',
          sources: source ? [source] : [],
          createdAt: now,
          updatedAt: now,
        };

        const upserted = await sendMessage('WORDBOOK_UPSERT', { entry } as any);
        if (token !== this.wordCardWordbookToken) return;
        if (upserted.ok) {
          setWordbookUi((upserted.value as any)?.state ?? 'active');
        } else {
          setWordbookUi(null);
        }
      } finally {
        if (token === this.wordCardWordbookToken) {
          wordbookButton.disabled = false;
        }
      }
    });

    void refreshWordbookState();

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
    if (!this.wordCardVisible) return;
    this.wordCardVisible = false;
    this.wordCardPinned = false;
    this.wordCardSpeakToken++;
    stop();
    this.wordCardElement.classList.remove('visible');
    this.wordCardElement.setAttribute('aria-hidden', 'true');
    this.detachDocumentClickListener();
  }

  handleMouseMove(event: MouseEvent): void {
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
  }

  handleMouseLeave(): void {
    if (this.wordCardPinned) return;
    this.hoverWord = null;
    this.hoverRect = null;
    this.clearHoverOpenTimer();
    this.scheduleHoverClose();
  }

  handleWordCardMouseEnter(): void {
    this.clearHoverCloseTimer();
  }

  handleWordCardMouseLeave(): void {
    if (this.wordCardPinned) return;
    this.scheduleHoverClose();
  }

  // Called by SubtitleOverlay click handler; returns true if it handled the click.
  handleClick(event: MouseEvent): boolean {
    const target = event.target as HTMLElement | null;
    const wordEl = target?.closest?.('[data-lexipath-word]') as HTMLElement | null;
    const word = wordEl?.dataset?.lexipathWord;
    if (wordEl && word && this.onWordClick) {
      event.stopPropagation();
      const rect = wordEl.getBoundingClientRect();
      this.onWordClick(word, rect);
      return true;
    }

    return false;
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
}

import type { EnglishCorrectionOutput, Settings } from '@lexipath/core';
import { sendMessage } from '../../shared/messages';
import { getI18nMessage } from '../i18n';
import { showCorrectionCard } from './card';
import { containsEnglishSentence, looksLikeUrlOnly } from './heuristics';
import { getEditableText, isSupportedEditableTarget, setEditableText } from './editor';

type EditableTarget = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

type AppliedCorrection = {
  originalText: string;
  correctedText: string;
};

export class EnglishCorrectionController {
  private settings: Settings | null = null;
  private enabled = false;
  private started = false;

  private pressCount = 0;
  private lastPressAt = 0;

  private inFlight = new WeakMap<EditableTarget, Promise<void>>();
  private lastApplied = new WeakMap<EditableTarget, AppliedCorrection>();

  setSettings(settings: Settings | null): void {
    this.settings = settings;
    this.enabled = Boolean(settings?.enabled && settings?.englishCorrection?.enabled);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
  }

  destroy(): void {
    if (!this.started) return;
    this.started = false;
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    this.inFlight = new WeakMap();
    this.lastApplied = new WeakMap();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (!this.settings) return;

    const isUndo = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && (event.key === 'z' || event.key === 'Z');
    if (!isUndo) return;

    const target = (() => {
      const direct = event.target;
      if (isSupportedEditableTarget(direct)) return direct;
      const active = document.activeElement;
      if (isSupportedEditableTarget(active)) return active;
      return null;
    })();

    if (!target) return;
    if (!this.tryUndo(target)) return;

    event.preventDefault();
    event.stopPropagation();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (!this.settings) return;

    const config = this.settings.englishCorrection;
    if (!config.enabled) return;

    const isSpace =
      config.triggerKey === 'space' ? event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar' : event.key === config.triggerKey;
    if (!isSpace) return;

    const target = event.target;
    if (!isSupportedEditableTarget(target)) return;

    const now = Date.now();
    if (now - this.lastPressAt > config.triggerTimeout) {
      this.pressCount = 1;
    } else {
      this.pressCount += 1;
    }
    this.lastPressAt = now;

    if (this.pressCount !== config.triggerTimes) return;
    this.pressCount = 0;

    void this.triggerCorrection(target);
  };

  private tryUndo(target: EditableTarget): boolean {
    const last = this.lastApplied.get(target);
    if (!last) return false;

    const current = getEditableText(target);
    if (current !== last.correctedText) return false;

    setEditableText(target, last.originalText);
    this.lastApplied.delete(target);
    return true;
  }

  private async triggerCorrection(target: EditableTarget): Promise<void> {
    if (!this.enabled || !this.settings) return;

    const existing = this.inFlight.get(target);
    if (existing) return;

    const promise = this.runCorrection(target).finally(() => {
      this.inFlight.delete(target);
    });

    this.inFlight.set(target, promise);
    await promise;
  }

  private async runCorrection(target: EditableTarget): Promise<void> {
    if (!this.settings) return;
    const config = this.settings.englishCorrection;

    const originalText = getEditableText(target);
    const trimmed = originalText.trim();
    if (!trimmed) return;
    if (looksLikeUrlOnly(trimmed)) return;
    if (!containsEnglishSentence(trimmed)) return;

    const anchorRect = (target instanceof Element && typeof target.getBoundingClientRect === 'function')
      ? target.getBoundingClientRect()
      : new DOMRect(10, 10, 10, 10);

    const response = await sendMessage<EnglishCorrectionOutput>('ENGLISH_CORRECTION', { text: trimmed });

    if (!response.ok) {
      showCorrectionCard({
        kind: 'error',
        message: getI18nMessage('englishCorrection_error'),
        anchorRect,
        autoCloseDelayMs: config.autoCloseDelay,
        theme: this.settings.theme,
      });
      return;
    }

    const result = response.value;
    if (!result.hasError) {
      const message = result.message?.trim() || getI18nMessage('englishCorrection_ok');
      showCorrectionCard({
        kind: 'encouragement',
        message,
        anchorRect,
        autoCloseDelayMs: config.autoCloseDelay,
        theme: this.settings.theme,
      });
      return;
    }

    const corrected = result.corrected?.trim();
    if (!corrected || corrected === trimmed) {
      const message = result.message?.trim() || getI18nMessage('englishCorrection_ok');
      showCorrectionCard({
        kind: 'encouragement',
        message,
        anchorRect,
        autoCloseDelayMs: config.autoCloseDelay,
        theme: this.settings.theme,
      });
      return;
    }

    const leading = originalText.match(/^\s*/)?.[0] ?? '';
    const trailing = originalText.match(/\s*$/)?.[0] ?? '';
    const correctedText = `${leading}${corrected}${trailing}`;

    setEditableText(target, correctedText);
    this.lastApplied.set(target, { originalText, correctedText });
    const message = result.message?.trim() || getI18nMessage('englishCorrection_corrected');

    showCorrectionCard({
      kind: 'corrected',
      message,
      anchorRect,
      showUndo: config.showUndoButton,
      onUndo: () => {
        setEditableText(target, originalText);
        this.lastApplied.delete(target);
      },
      theme: this.settings.theme,
    });
  }
}

import type { Cue, EnhanceSubtitlePayload, Response, SubtitleEnhanceOutput, SupportedLanguage } from '@lexipath/core';
import { createLogger, getErrorMessage } from '@lexipath/core/log';

const SLOW_LOG_THRESHOLD_MS = 800;
const BILINGUAL_RETRY_MIN_INTERVAL_MS = 10_000;
const log = createLogger('subtitle-enhancer');

export class SubtitleEnhancer {
  private destroyed = false;
  private started = false;

  private cues: Cue[] = [];
  private cuesToken = 0;
  private cueIndexById = new Map<string, number>();

  private subtitleLanguage = '';

  private readonly maxInFlight: number;
  private inFlight = 0;
  private queueIndex = 0;

  private enhancedCueCount = 0;
  private enhanced = new Map<string, SubtitleEnhanceOutput>();

  private bilingualCueInFlight = new Map<string, Promise<void>>();
  private bilingualCueLastAttemptAt = new Map<string, number>();

  private readonly sendEnhanceSubtitle: (payload: EnhanceSubtitlePayload) => Promise<Response<SubtitleEnhanceOutput>>;
  private readonly getSourceLang: (cue: Cue, subtitleLanguage: string) => SupportedLanguage;
  private readonly isPaused: () => boolean;
  private readonly onCueEnhanced: ((cueId: string) => void) | undefined;
  private readonly getContextWindowSize: (() => number) | undefined;

  constructor(options: {
    maxInFlight?: number;
    isPaused: () => boolean;
    sendEnhanceSubtitle: (payload: EnhanceSubtitlePayload) => Promise<Response<SubtitleEnhanceOutput>>;
    getSourceLang: (cue: Cue, subtitleLanguage: string) => SupportedLanguage;
    onCueEnhanced?: (cueId: string) => void;
    getContextWindowSize?: () => number;
  }) {
    this.maxInFlight = options.maxInFlight ?? 2;
    this.isPaused = options.isPaused;
    this.sendEnhanceSubtitle = options.sendEnhanceSubtitle;
    this.getSourceLang = options.getSourceLang;
    this.onCueEnhanced = options.onCueEnhanced;
    this.getContextWindowSize = options.getContextWindowSize;
  }

  destroy(): void {
    this.destroyed = true;
    this.started = false;
    this.cues = [];
    this.cuesToken++;
    this.cueIndexById.clear();
    this.inFlight = 0;
    this.queueIndex = 0;
    this.enhancedCueCount = 0;
    this.enhanced.clear();
    this.bilingualCueInFlight.clear();
    this.bilingualCueLastAttemptAt.clear();
  }

  setCues(cues: Cue[], options: { token: number; subtitleLanguage: string }): void {
    this.cues = cues;
    this.cuesToken = options.token;
    this.subtitleLanguage = options.subtitleLanguage;
    this.cueIndexById = new Map(cues.map((cue, idx) => [cue.id, idx] as const));

    this.queueIndex = 0;
    this.inFlight = 0;
    this.enhancedCueCount = 0;
    this.enhanced.clear();
    this.bilingualCueInFlight.clear();
    this.bilingualCueLastAttemptAt.clear();
  }

  appendCues(cues: Cue[], options: { subtitleLanguage: string }): void {
    this.cues = cues;
    this.subtitleLanguage = options.subtitleLanguage;
    this.cueIndexById = new Map(cues.map((cue, idx) => [cue.id, idx] as const));

    // Do not reset enhanced results; allow the pipeline to keep running and
    // continue from the current queueIndex.
    this.queueIndex = Math.min(this.queueIndex, cues.length);
    this.pump();
  }

  private clampContextWindowSize(): number {
    const n = this.getContextWindowSize?.();
    const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0;
    return Math.max(0, Math.min(6, v));
  }

  private buildCueContextWindow(cueIndex: number, centerText: string): { before: string[]; after: string[] } {
    const windowSize = this.clampContextWindowSize();
    if (windowSize <= 0) return { before: [], after: [] };

    const before: string[] = [];
    const after: string[] = [];

    const start = Math.max(0, cueIndex - windowSize);
    const end = Math.min(this.cues.length - 1, cueIndex + windowSize);

    for (let i = start; i <= end; i += 1) {
      if (i === cueIndex) continue;
      const cue = this.cues[i];
      const text = cue?.text?.trim?.() ?? '';
      if (!text) continue;
      if (i < cueIndex) before.push(text);
      else after.push(text);
    }

    const center = centerText.trim();
    if (center) before.push(center);

    return { before, after };
  }

  start(): void {
    if (this.destroyed) return;
    if (!this.started) {
      this.started = true;
    }
    this.pump();
  }

  stop(): void {
    this.started = false;
  }

  pump(): void {
    if (this.destroyed) return;
    if (!this.started) return;
    if (this.cues.length === 0) return;
    if (this.isPaused()) return;

    while (this.inFlight < this.maxInFlight && this.queueIndex < this.cues.length) {
      const cueIndex = this.queueIndex;
      const cue = this.cues[this.queueIndex++];
      if (!cue) continue;
      if (this.enhanced.has(cue.id)) continue;
      if (!cue.text || cue.text.trim().length < 2) continue;

      this.inFlight++;
      const token = this.cuesToken;
      void this.enhanceCue(cue, cueIndex, token)
        .catch((error: unknown) => {
          log.warn('enhanceCue threw; keeping pipeline moving', { cueId: cue.id, message: getErrorMessage(error) });
        })
        .finally(() => {
          this.inFlight--;
          this.pump();
        });
    }
  }

  getEnhanced(cueId: string): SubtitleEnhanceOutput | undefined {
    return this.enhanced.get(cueId);
  }

  ensureBilingual(cue: Cue): Promise<void> {
    const existing = this.enhanced.get(cue.id);
    if (existing && typeof existing.line2_final === 'string' && existing.line2_final.trim()) {
      return Promise.resolve();
    }

    const inFlight = this.bilingualCueInFlight.get(cue.id);
    if (inFlight) return inFlight;

    const now = Date.now();
    const lastAttemptAt = this.bilingualCueLastAttemptAt.get(cue.id) ?? 0;
    if (now - lastAttemptAt < BILINGUAL_RETRY_MIN_INTERVAL_MS) {
      return Promise.resolve();
    }
    this.bilingualCueLastAttemptAt.set(cue.id, now);

    const token = this.cuesToken;
    const promise = (async () => {
      const cueIndex = this.cueIndexById.get(cue.id) ?? -1;
      const contextWindow = cueIndex >= 0 ? this.buildCueContextWindow(cueIndex, cue.text) : { before: [], after: [] };
      const response = await this.sendEnhanceSubtitle({
        subtitle: cue.text,
        sourceLang: this.getSourceLang(cue, this.subtitleLanguage),
        mode: 'bilingual',
        ...((contextWindow.before.length || contextWindow.after.length)
          ? { contextBefore: contextWindow.before, contextAfter: contextWindow.after }
          : {}),
      });

      if (!response.ok) return;
      if (this.destroyed || token !== this.cuesToken) return;

      const enhanced = response.value;
      if (!enhanced || !enhanced.line1_final || !enhanced.line1_final.trim()) return;

      const prev = this.enhanced.get(cue.id) ?? ({} as SubtitleEnhanceOutput);
      this.enhanced.set(cue.id, { ...prev, ...enhanced });
      this.onCueEnhanced?.(cue.id);
    })().finally(() => {
      this.bilingualCueInFlight.delete(cue.id);
    });

    this.bilingualCueInFlight.set(cue.id, promise);
    return promise;
  }

  private async enhanceCue(cue: Cue, cueIndex: number, token: number): Promise<void> {
    const startMs = performance.now();
    try {
      const contextWindow = this.buildCueContextWindow(cueIndex, cue.text);
      const response = await this.sendEnhanceSubtitle({
        subtitle: cue.text,
        sourceLang: this.getSourceLang(cue, this.subtitleLanguage),
        mode: 'single',
        ...((contextWindow.before.length || contextWindow.after.length)
          ? { contextBefore: contextWindow.before, contextAfter: contextWindow.after }
          : {}),
      });

      if (!response.ok) {
        log.warn(`Failed to enhance cue ${cue.id}`, response.error);
        return;
      }

      if (this.destroyed || token !== this.cuesToken) return;

      const enhanced = response.value;
      if (!enhanced.line1_final || !enhanced.line1_final.trim()) return;

      this.enhanced.set(cue.id, enhanced);
      this.enhancedCueCount++;
      this.onCueEnhanced?.(cue.id);
    } finally {
      const elapsedMs = Math.round(performance.now() - startMs);
      if (elapsedMs >= SLOW_LOG_THRESHOLD_MS || this.enhancedCueCount % 20 === 0) {
        log.info(`Enhanced ${this.enhancedCueCount}/${this.cues.length} cues (lastMs=${elapsedMs})`);
      }
    }
  }
}

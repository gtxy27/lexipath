import type { Cue, EnhanceSubtitlePayload, Response, SubtitleEnhanceOutput, SupportedLanguage } from '@lexipath/core';

const SLOW_LOG_THRESHOLD_MS = 800;
const BILINGUAL_RETRY_MIN_INTERVAL_MS = 10_000;

export class SubtitleEnhancer {
  private destroyed = false;
  private started = false;

  private cues: Cue[] = [];
  private cuesToken = 0;

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

  constructor(options: {
    maxInFlight?: number;
    isPaused: () => boolean;
    sendEnhanceSubtitle: (payload: EnhanceSubtitlePayload) => Promise<Response<SubtitleEnhanceOutput>>;
    getSourceLang: (cue: Cue, subtitleLanguage: string) => SupportedLanguage;
    onCueEnhanced?: (cueId: string) => void;
  }) {
    this.maxInFlight = options.maxInFlight ?? 2;
    this.isPaused = options.isPaused;
    this.sendEnhanceSubtitle = options.sendEnhanceSubtitle;
    this.getSourceLang = options.getSourceLang;
    this.onCueEnhanced = options.onCueEnhanced;
  }

  destroy(): void {
    this.destroyed = true;
    this.started = false;
    this.cues = [];
    this.cuesToken++;
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

    this.queueIndex = 0;
    this.inFlight = 0;
    this.enhancedCueCount = 0;
    this.enhanced.clear();
    this.bilingualCueInFlight.clear();
    this.bilingualCueLastAttemptAt.clear();
  }

  start(): void {
    if (this.destroyed) return;
    if (!this.started) {
      this.started = true;
    }
    this.pump();
  }

  pump(): void {
    if (this.destroyed) return;
    if (!this.started) return;
    if (this.cues.length === 0) return;
    if (this.isPaused()) return;

    while (this.inFlight < this.maxInFlight && this.queueIndex < this.cues.length) {
      const cue = this.cues[this.queueIndex++];
      if (!cue) continue;
      if (this.enhanced.has(cue.id)) continue;
      if (!cue.text || cue.text.trim().length < 2) continue;

      this.inFlight++;
      const token = this.cuesToken;
      void this.enhanceCue(cue, token)
        .catch(() => {
          // enhanceCue logs; keep pipeline moving
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
      const response = await this.sendEnhanceSubtitle({
        subtitle: cue.text,
        sourceLang: this.getSourceLang(cue, this.subtitleLanguage),
        mode: 'bilingual',
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

  private async enhanceCue(cue: Cue, token: number): Promise<void> {
    const startMs = performance.now();
    try {
      const response = await this.sendEnhanceSubtitle({
        subtitle: cue.text,
        sourceLang: this.getSourceLang(cue, this.subtitleLanguage),
        mode: 'single',
      });

      if (!response.ok) {
        console.warn(`[SubtitleEnhancer] Failed to enhance cue ${cue.id}:`, response.error);
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
        console.log(`[SubtitleEnhancer] Enhanced ${this.enhancedCueCount}/${this.cues.length} cues (lastMs=${elapsedMs})`);
      }
    }
  }
}

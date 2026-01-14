import type { Cue } from '@lexipath/core';

export class SubtitleVideoSync {
  private videoElement: HTMLVideoElement | null = null;
  private cues: Cue[] = [];
  private rafId: number | null = null;
  private currentCueIndex = -1;

  private readonly onCueIndexChange: ((index: number) => void) | undefined;

  constructor(options?: { onCueIndexChange?: (index: number) => void }) {
    this.onCueIndexChange = options?.onCueIndexChange;
  }

  setVideoElement(videoElement: HTMLVideoElement | null): void {
    this.videoElement = videoElement;
  }

  setCues(cues: Cue[]): void {
    this.cues = cues;
    this.currentCueIndex = -1;
  }

  getCurrentCueIndex(): number {
    return this.currentCueIndex;
  }

  start(): void {
    if (this.rafId !== null) return;

    const loop = () => {
      this.syncOnce();
      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  destroy(): void {
    this.stop();
    this.videoElement = null;
    this.cues = [];
    this.currentCueIndex = -1;
  }

  syncOnce(): void {
    if (!this.videoElement) return;
    if (this.cues.length === 0) return;

    const currentTimeMs = this.videoElement.currentTime * 1000;
    const nextIndex = this.findCueIndexAtTimeMs(currentTimeMs);
    if (nextIndex === this.currentCueIndex) return;

    this.currentCueIndex = nextIndex;
    this.onCueIndexChange?.(nextIndex);
  }

  findCueIndexAtTimeMs(timeMs: number): number {
    const cueCount = this.cues.length;
    if (cueCount === 0) return -1;

    const currentIndex = this.currentCueIndex;
    if (currentIndex >= 0 && currentIndex < cueCount) {
      const currentCue = this.cues[currentIndex];
      if (currentCue && timeMs >= currentCue.startMs && timeMs < currentCue.endMs) {
        return currentIndex;
      }

      const nextCue = this.cues[currentIndex + 1];
      if (nextCue && timeMs >= nextCue.startMs && timeMs < nextCue.endMs) {
        return currentIndex + 1;
      }

      const prevCue = this.cues[currentIndex - 1];
      if (prevCue && timeMs >= prevCue.startMs && timeMs < prevCue.endMs) {
        return currentIndex - 1;
      }
    }

    // Binary search: find the last cue with startMs <= timeMs, then validate its endMs.
    let lo = 0;
    let hi = cueCount - 1;
    let candidate = -1;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cue = this.cues[mid];
      if (!cue) break;

      if (timeMs >= cue.startMs) {
        candidate = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (candidate < 0) return -1;
    const found = this.cues[candidate];
    return found && timeMs < found.endMs ? candidate : -1;
  }

  findFirstCueIndexAfterTimeMs(timeMs: number): number {
    const cueCount = this.cues.length;
    if (cueCount === 0) return 0;

    // Find first cue with startMs >= timeMs (lower bound), then rewind one step in case the
    // previous cue still overlaps timeMs.
    let lo = 0;
    let hi = cueCount;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const cue = this.cues[mid];
      if (!cue) break;
      if (cue.startMs < timeMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    let index = Math.max(0, lo - 1);
    while (index < cueCount) {
      const cue = this.cues[index];
      if (!cue) break;
      if (cue.endMs > timeMs) break;
      index++;
    }

    return index;
  }
}

const DANMU_RESTORE_DELAY_MS = 3000;
const DEFAULT_HIDE_BOTTOM_RATIO = 0.2;

export class BilibiliDanmuManager {
  private readonly styleId = 'lexipath-hide-bilibili-danmu';
  private restoreTimer: number | null = null;
  private styleEl: HTMLStyleElement | null = null;
  private destroyed = false;

  private hideBottomRatio = DEFAULT_HIDE_BOTTOM_RATIO;

  destroy(): void {
    this.destroyed = true;
    this.clearRestoreTimer();
    this.showDanmu();
  }

  onSubtitleVisible(): void {
    if (this.destroyed) return;
    this.clearRestoreTimer();
    this.hideDanmu();
  }

  onSubtitleHidden(): void {
    if (this.destroyed) return;
    this.clearRestoreTimer();
    this.restoreTimer = window.setTimeout(() => {
      this.restoreTimer = null;
      this.showDanmu();
    }, DANMU_RESTORE_DELAY_MS);
  }

  private clearRestoreTimer(): void {
    if (this.restoreTimer === null) return;
    window.clearTimeout(this.restoreTimer);
    this.restoreTimer = null;
  }

  private hideDanmu(): void {
    if (this.styleEl && this.styleEl.isConnected) return;

    const style = document.createElement('style');
    style.id = this.styleId;
    const bottomPercent = Math.round(this.hideBottomRatio * 100);
    style.textContent = `
      /* Hide only the bottom region of Bilibili danmu to avoid covering subtitles. */
      .bilibili-player-video-danmaku,
      .bpx-player-video-danmaku,
      .bpx-player-dm-wrap {
        clip-path: inset(0 0 ${bottomPercent}% 0) !important;
        -webkit-clip-path: inset(0 0 ${bottomPercent}% 0) !important;
      }
    `;

    (document.documentElement || document.head || document.body).appendChild(style);
    this.styleEl = style;
  }

  private showDanmu(): void {
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    } else {
      document.getElementById(this.styleId)?.remove();
    }
  }
}

import { createLogger, getErrorMessage } from '@lexipath/core/log';

export type PlatformCaptionsWatcherPlatform = 'youtube' | 'bilibili';

type EnabledListener = (enabled: boolean) => void;

const log = createLogger('platform-captions-watcher');

export class PlatformCaptionsWatcher {
  private enabled: boolean | null = null;
  private watchToken = 0;
  private observer: MutationObserver | null = null;
  private pollTimer: number | null = null;
  private button: HTMLElement | null = null;

  constructor(
    private readonly platform: PlatformCaptionsWatcherPlatform,
    private readonly onChange: EnabledListener,
  ) {}

  start(): void {
    this.stop();
    const token = ++this.watchToken;

    const poll = () => {
      if (token !== this.watchToken) return;

      const button = this.findCaptionsButton();
      if (!button) {
        this.pollTimer = window.setTimeout(poll, 1000);
        return;
      }

      this.button = button;
      this.pollTimer = null;

      const update = () => {
        this.refreshEnabled();
      };

      update();
      this.observer = new MutationObserver(update);
      this.observer.observe(button, {
        attributes: true,
        attributeFilter: ['aria-pressed', 'aria-checked', 'class'],
      });
    };

    poll();
  }

  stop(): void {
    this.watchToken++;
    if (this.pollTimer !== null) {
      window.clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.button = null;
    this.enabled = null;
  }

  getEnabled(): boolean | null {
    return this.enabled;
  }

  private findCaptionsButton(): HTMLElement | null {
    if (this.platform === 'youtube') {
      const button = document.querySelector('.ytp-subtitles-button');
      return button instanceof HTMLElement ? button : null;
    }

    const selectors = [
      '.bpx-player-ctrl-subtitle',
      '.bpx-player-ctrl-btn.bpx-player-ctrl-subtitle',
      '.bilibili-player-video-btn-subtitle',
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button instanceof HTMLElement) return button;
    }

    return null;
  }

  private refreshEnabled(): void {
    const button = this.button;
    if (!button) return;

    const enabled = this.getEnabledFromButton(button);
    if (enabled === null) return;
    if (this.enabled === enabled) return;

    this.enabled = enabled;
    try {
      this.onChange(enabled);
    } catch (error: unknown) {
      log.debug('onChange threw; ignoring', { message: getErrorMessage(error) });
    }
  }

  private getEnabledFromButton(button: HTMLElement): boolean | null {
    const ariaPressed = button.getAttribute('aria-pressed');
    if (ariaPressed === 'true') return true;
    if (ariaPressed === 'false') return false;

    const ariaChecked = button.getAttribute('aria-checked');
    if (ariaChecked === 'true') return true;
    if (ariaChecked === 'false') return false;

    if (
      button.classList.contains('bpx-player-ctrl-btn-active') ||
      button.classList.contains('bilibili-player-video-btn-subtitle-on') ||
      button.classList.contains('active')
    ) {
      return true;
    }

    if (button.classList.contains('bilibili-player-video-btn-subtitle-off')) {
      return false;
    }

    // For Bilibili, check if there's an active subtitle selection in the menu.
    const isLikelyBilibiliButton =
      button.classList.contains('bpx-player-ctrl-subtitle') ||
      button.classList.contains('bilibili-player-video-btn-subtitle');

    if (isLikelyBilibiliButton) {
      // If the "close" switch is NOT active, subtitles are on.
      const closeSwitch = button.querySelector('.bpx-player-ctrl-subtitle-close-switch');
      if (closeSwitch && !closeSwitch.classList.contains('bpx-state-active')) {
        return true;
      }

      // Also check if bilibili subtitle is actually visible on page.
      const subtitleWrap = document.querySelector('.bpx-player-subtitle-wrap');
      if (subtitleWrap instanceof HTMLElement) {
        const display = window.getComputedStyle(subtitleWrap).display;
        if (display !== 'none') return true;
      }

      // Fail-closed: if no active subtitle is detected, assume subtitles are off.
      return false;
    }

    return null;
  }
}

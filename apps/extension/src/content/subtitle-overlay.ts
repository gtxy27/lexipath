/**
 * Subtitle Overlay Component
 *
 * Renders subtitles using Shadow DOM for style isolation.
 * Supports both overlay (on video) and below-video positioning.
 */

export type SubtitleMode = 'enhanced' | 'bilingual' | 'bilingual-temp';

export interface SubtitleLine {
  text: string;
  isEnhanced: boolean; // true for enhanced line, false for original
}

export interface SubtitleDisplayOptions {
  mode: SubtitleMode;
  lines: SubtitleLine[];
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
  private platform: 'youtube' | 'bilibili';
  private mode: SubtitleMode = 'enhanced';
  private onModeChange?: (mode: SubtitleMode) => void;

  constructor(
    platform: 'youtube' | 'bilibili',
    options?: { onModeChange?: (mode: SubtitleMode) => void }
  ) {
    this.platform = platform;
    if (options?.onModeChange) {
      this.onModeChange = options.onModeChange;
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
    this.shadow.innerHTML = this.getStyles() + this.getTemplate();

    // Get subtitle element
    this.subtitleElement = this.shadow.querySelector('.lexipath-subtitle') as HTMLDivElement;

    // Setup click handler for mode switching
    if (this.subtitleElement) {
      this.subtitleElement.style.pointerEvents = 'auto';
      this.subtitleElement.style.cursor = 'pointer';
      this.subtitleElement.addEventListener('click', this.handleClick.bind(this));
    }

    // Append to video container
    videoContainer.appendChild(this.container);

    console.log('[SubtitleOverlay] Mounted successfully');
    return true;
  }

  /**
   * Unmount and cleanup
   */
  unmount(): void {
    if (this.container && this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
    this.container = null;
    this.shadow = null;
    this.subtitleElement = null;
  }

  /**
   * Update subtitle display
   */
  display(options: SubtitleDisplayOptions): void {
    if (!this.subtitleElement) {
      console.warn('[SubtitleOverlay] Not mounted');
      return;
    }

    this.mode = options.mode;
    const { lines } = options;

    if (lines.length === 0) {
      this.clear();
      return;
    }

    // Build HTML content
    const html = lines
      .map((line, index) => {
        const className = line.isEnhanced ? 'line-enhanced' : 'line-original';
        return `<div class="${className}">${this.escapeHtml(line.text)}</div>`;
      })
      .join('');

    this.subtitleElement.innerHTML = html;
    this.subtitleElement.classList.add('visible');
  }

  /**
   * Clear subtitle display
   */
  clear(): void {
    if (!this.subtitleElement) return;
    this.subtitleElement.innerHTML = '';
    this.subtitleElement.classList.remove('visible');
  }

  /**
   * Get current mode
   */
  getMode(): SubtitleMode {
    return this.mode;
  }

  /**
   * Set mode
   */
  setMode(mode: SubtitleMode): void {
    this.mode = mode;
  }

  /**
   * Handle click to toggle mode
   */
  private handleClick(): void {
    const nextMode: SubtitleMode = this.mode === 'enhanced' ? 'bilingual' : 'enhanced';
    this.mode = nextMode;
    this.onModeChange?.(nextMode);
  }

  /**
   * Find video container element
   */
  private findVideoContainer(): HTMLElement | null {
    const selector = getVideoContainerSelector(this.platform);
    if (!selector) return null;

    // Try multiple selectors for bilibili
    if (this.platform === 'bilibili') {
      const selectors = selector.split(', ');
      for (const sel of selectors) {
        const elem = document.querySelector(sel.trim());
        if (elem instanceof HTMLElement) return elem;
      }
      return null;
    }

    const elem = document.querySelector(selector);
    return elem instanceof HTMLElement ? elem : null;
  }

  /**
   * Get Shadow DOM styles
   */
  private getStyles(): string {
    return `
      <style>
        .lexipath-subtitle {
          display: none;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          max-width: 90%;
          padding: 8px 16px;
          background: rgba(0, 0, 0, 0.8);
          border-radius: 4px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          font-size: 20px;
          line-height: 1.4;
          color: #ffffff;
          text-align: center;
          text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.8);
          transition: opacity 0.2s ease;
        }

        .lexipath-subtitle.visible {
          display: flex;
        }

        .line-enhanced {
          font-weight: 600;
          color: #ffffff;
        }

        .line-original {
          font-size: 16px;
          font-weight: 400;
          color: #cccccc;
          opacity: 0.9;
        }

        .lexipath-subtitle:hover {
          opacity: 0.95;
        }
      </style>
    `;
  }

  /**
   * Get Shadow DOM template
   */
  private getTemplate(): string {
    return `
      <div class="lexipath-subtitle"></div>
    `;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

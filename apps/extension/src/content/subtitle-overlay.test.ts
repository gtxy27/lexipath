/**
 * @vitest-environment happy-dom
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubtitleOverlay, getVideoContainerSelector, type SubtitleLine } from './subtitle-overlay';

describe('getVideoContainerSelector', () => {
  it('returns correct selector for YouTube', () => {
    expect(getVideoContainerSelector('youtube')).toBe('#movie_player');
  });

  it('returns correct selector for Bilibili', () => {
    const selector = getVideoContainerSelector('bilibili');
    expect(selector).toContain('.bpx-player-container');
    expect(selector).toContain('.bilibili-player-video-wrap');
  });
});

describe('SubtitleOverlay', () => {
  let videoContainer: HTMLDivElement;

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = '';

    // Create mock video container for YouTube
    videoContainer = document.createElement('div');
    videoContainer.id = 'movie_player';
    document.body.appendChild(videoContainer);
  });

  describe('mount', () => {
    it('creates and mounts overlay container', () => {
      const overlay = new SubtitleOverlay('youtube');
      const result = overlay.mount();

      expect(result).toBe(true);
      expect(videoContainer.querySelector('#lexipath-subtitle-overlay')).toBeTruthy();
    });

    it('prevents double mounting', () => {
      const overlay = new SubtitleOverlay('youtube');
      overlay.mount();
      const result = overlay.mount();

      expect(result).toBe(true);
      // Should only have one overlay
      expect(videoContainer.querySelectorAll('#lexipath-subtitle-overlay')).toHaveLength(1);
    });

    it('returns false when video container not found', () => {
      document.body.innerHTML = '';
      const overlay = new SubtitleOverlay('youtube');
      const result = overlay.mount();

      expect(result).toBe(false);
    });

    it('creates shadow DOM for style isolation', () => {
      const overlay = new SubtitleOverlay('youtube');
      overlay.mount();

      const container = videoContainer.querySelector('#lexipath-subtitle-overlay') as HTMLDivElement;
      expect(container?.shadowRoot).toBeTruthy();
    });

    it('sets up subtitle element inside shadow DOM', () => {
      const overlay = new SubtitleOverlay('youtube');
      overlay.mount();

      const container = videoContainer.querySelector('#lexipath-subtitle-overlay') as HTMLDivElement;
      const shadow = container?.shadowRoot;
      const subtitleElement = shadow?.querySelector('.lexipath-subtitle');

      expect(subtitleElement).toBeTruthy();
    });
  });

  describe('display', () => {
    it('displays single enhanced subtitle line', () => {
      const overlay = new SubtitleOverlay('youtube');
      overlay.mount();

      const lines: SubtitleLine[] = [{ text: 'Enhanced subtitle text', isEnhanced: true }];

      overlay.display({ mode: 'enhanced', lines });

      const container = videoContainer.querySelector('#lexipath-subtitle-overlay') as HTMLDivElement;
      const shadow = container?.shadowRoot;
      const subtitleElement = shadow?.querySelector('.lexipath-subtitle');

      expect(subtitleElement?.classList.contains('visible')).toBe(true);
      expect(subtitleElement?.innerHTML).toContain('Enhanced subtitle text');
      expect(subtitleElement?.innerHTML).toContain('line-enhanced');
    });

    it('displays bilingual subtitles with enhanced and original lines', () => {
      const overlay = new SubtitleOverlay('youtube');
      overlay.mount();

      const lines: SubtitleLine[] = [
        { text: 'Enhanced text', isEnhanced: true },
        { text: 'Original text', isEnhanced: false },
      ];

      overlay.display({ mode: 'bilingual', lines });

      const container = videoContainer.querySelector('#lexipath-subtitle-overlay') as HTMLDivElement;
      const shadow = container?.shadowRoot;
      const subtitleElement = shadow?.querySelector('.lexipath-subtitle');

      expect(subtitleElement?.innerHTML).toContain('Enhanced text');
      expect(subtitleElement?.innerHTML).toContain('Original text');
      expect(subtitleElement?.innerHTML).toContain('line-enhanced');
      expect(subtitleElement?.innerHTML).toContain('line-original');
    });

    it('clears display when given empty lines', () => {
      const overlay = new SubtitleOverlay('youtube');
      overlay.mount();

      // Display something first
      overlay.display({ mode: 'enhanced', lines: [{ text: 'Test', isEnhanced: true }] });

      // Then display empty
      overlay.display({ mode: 'enhanced', lines: [] });

      const container = videoContainer.querySelector('#lexipath-subtitle-overlay') as HTMLDivElement;
      const shadow = container?.shadowRoot;
      const subtitleElement = shadow?.querySelector('.lexipath-subtitle');

      expect(subtitleElement?.innerHTML).toBe('');
      expect(subtitleElement?.classList.contains('visible')).toBe(false);
    });

    it('escapes HTML to prevent XSS attacks', () => {
      const overlay = new SubtitleOverlay('youtube');
      overlay.mount();

      const lines: SubtitleLine[] = [
        { text: '<script>alert("xss")</script>', isEnhanced: true },
      ];

      overlay.display({ mode: 'enhanced', lines });

      const container = videoContainer.querySelector('#lexipath-subtitle-overlay') as HTMLDivElement;
      const shadow = container?.shadowRoot;
      const subtitleElement = shadow?.querySelector('.lexipath-subtitle');

      // Should escape the script tag
      expect(subtitleElement?.innerHTML).not.toContain('<script>');
      expect(subtitleElement?.innerHTML).toContain('&lt;script&gt;');
    });
  });

  describe('clear', () => {
    it('clears subtitle display and removes visible class', () => {
      const overlay = new SubtitleOverlay('youtube');
      overlay.mount();

      const lines: SubtitleLine[] = [{ text: 'Test', isEnhanced: true }];
      overlay.display({ mode: 'enhanced', lines });

      overlay.clear();

      const container = videoContainer.querySelector('#lexipath-subtitle-overlay') as HTMLDivElement;
      const shadow = container?.shadowRoot;
      const subtitleElement = shadow?.querySelector('.lexipath-subtitle');

      expect(subtitleElement?.innerHTML).toBe('');
      expect(subtitleElement?.classList.contains('visible')).toBe(false);
    });
  });

  describe('unmount', () => {
    it('removes overlay container from DOM', () => {
      const overlay = new SubtitleOverlay('youtube');
      overlay.mount();

      expect(videoContainer.querySelector('#lexipath-subtitle-overlay')).toBeTruthy();

      overlay.unmount();

      expect(videoContainer.querySelector('#lexipath-subtitle-overlay')).toBeFalsy();
    });

    it('handles unmount when not mounted', () => {
      const overlay = new SubtitleOverlay('youtube');
      // Should not throw
      expect(() => overlay.unmount()).not.toThrow();
    });
  });

  describe('mode management', () => {
    it('returns and sets mode correctly', () => {
      const overlay = new SubtitleOverlay('youtube');

      expect(overlay.getMode()).toBe('enhanced');

      overlay.setMode('bilingual');
      expect(overlay.getMode()).toBe('bilingual');

      overlay.setMode('enhanced');
      expect(overlay.getMode()).toBe('enhanced');
    });

    it('toggles mode on click and calls onModeChange callback', () => {
      const onModeChange = vi.fn();
      const overlay = new SubtitleOverlay('youtube', { onModeChange });
      overlay.mount();

      const container = videoContainer.querySelector('#lexipath-subtitle-overlay') as HTMLDivElement;
      const shadow = container?.shadowRoot;
      const subtitleElement = shadow?.querySelector('.lexipath-subtitle') as HTMLDivElement;

      // Display something to make it clickable
      overlay.display({ mode: 'enhanced', lines: [{ text: 'Test', isEnhanced: true }] });

      // Click to toggle
      subtitleElement.click();
      expect(onModeChange).toHaveBeenCalledWith('bilingual');
      expect(overlay.getMode()).toBe('bilingual');

      // Click again to toggle back
      subtitleElement.click();
      expect(onModeChange).toHaveBeenCalledWith('enhanced');
      expect(overlay.getMode()).toBe('enhanced');
    });
  });

  describe('platform support', () => {
    it('works with Bilibili platform', () => {
      document.body.innerHTML = '';

      // Create Bilibili container
      const bilibiliContainer = document.createElement('div');
      bilibiliContainer.className = 'bpx-player-container';
      document.body.appendChild(bilibiliContainer);

      const overlay = new SubtitleOverlay('bilibili');
      const result = overlay.mount();

      expect(result).toBe(true);
      expect(bilibiliContainer.querySelector('#lexipath-subtitle-overlay')).toBeTruthy();
    });

    it('supports alternative Bilibili container class', () => {
      document.body.innerHTML = '';

      // Create alternative Bilibili container
      const bilibiliContainer = document.createElement('div');
      bilibiliContainer.className = 'bilibili-player-video-wrap';
      document.body.appendChild(bilibiliContainer);

      const overlay = new SubtitleOverlay('bilibili');
      const result = overlay.mount();

      expect(result).toBe(true);
      expect(bilibiliContainer.querySelector('#lexipath-subtitle-overlay')).toBeTruthy();
    });
  });
});

/**
 * LexiPath Content Script
 *
 * Handles:
 * - Page text extraction and processing
 * - Overlay rendering (Shadow DOM)
 * - Word card interactions
 * - Subtitle rendering
 */

import type { Settings } from '@lexipath/core';
import { sendMessage } from '../shared/messages';
import { SubtitleController, detectPlatform } from './subtitle-controller';

let subtitleController: SubtitleController | null = null;

/**
 * Get current settings from background.
 */
async function getSettings(): Promise<Settings | null> {
  const response = await sendMessage('GET_SETTINGS', undefined);
  if (response.ok) {
    return response.value;
  }
  console.error('[LexiPath] Failed to get settings:', response.error);
  return null;
}

/**
 * Initialize subtitle controller for video platforms
 */
async function initSubtitleController(): Promise<void> {
  const url = window.location.href;
  const platform = detectPlatform(url);

  if (platform === 'unknown') {
    console.log('[LexiPath] Not a supported video platform');
    return;
  }

  console.log(`[LexiPath] Detected video platform: ${platform}`);

  // Wait for video element to be available
  const maxRetries = 20;
  let retries = 0;

  const checkVideoElement = async (): Promise<void> => {
    const videoElement = document.querySelector('video');

    if (videoElement instanceof HTMLVideoElement) {
      // Video element found, initialize controller
      subtitleController = new SubtitleController();
      const success = await subtitleController.init(url);

      if (success) {
        console.log('[LexiPath] Subtitle controller initialized');
      } else {
        console.warn('[LexiPath] Subtitle controller initialization failed');
      }
    } else if (retries < maxRetries) {
      // Retry after delay
      retries++;
      setTimeout(checkVideoElement, 500);
    } else {
      console.warn('[LexiPath] Video element not found after retries');
    }
  };

  await checkVideoElement();
}

/**
 * Initialize content script.
 */
async function init(): Promise<void> {
  const settings = await getSettings();

  if (!settings?.enabled) {
    console.log('[LexiPath] Extension is disabled');
    return;
  }

  console.log('[LexiPath] Content script initialized');

  // Initialize subtitle controller for video platforms
  await initSubtitleController();

  // TODO: Implement page processing
  // - Set up MutationObserver
  // - Process visible content
  // - Render overlays
}

/**
 * Cleanup on page unload
 */
function cleanup(): void {
  if (subtitleController) {
    subtitleController.destroy();
    subtitleController = null;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Cleanup on page unload
window.addEventListener('beforeunload', cleanup);

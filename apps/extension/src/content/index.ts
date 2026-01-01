/**
 * LexiPath Content Script
 *
 * Handles:
 * - Page text extraction and processing
 * - Overlay rendering (Shadow DOM)
 * - Word card interactions
 * - Subtitle rendering
 */

import browser from 'webextension-polyfill';
import type { Settings, Response } from '@lexipath/core';

/**
 * Send a message to the background script.
 */
async function sendMessage<T>(type: string, payload?: unknown): Promise<Response<T>> {
  return browser.runtime.sendMessage({ type, payload });
}

/**
 * Get current settings from background.
 */
async function getSettings(): Promise<Settings | null> {
  const response = await sendMessage<Settings>('GET_SETTINGS');
  if (response.ok) {
    return response.value;
  }
  console.error('[LexiPath] Failed to get settings:', response.error);
  return null;
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

  // TODO: Implement page processing
  // - Set up MutationObserver
  // - Process visible content
  // - Render overlays
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

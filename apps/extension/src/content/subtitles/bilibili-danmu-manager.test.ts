/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it, vi } from 'vitest';
import { BilibiliDanmuManager } from './bilibili-danmu-manager';

describe('BilibiliDanmuManager', () => {
  it('hides danmu while subtitles are visible and restores after delay', () => {
    vi.useFakeTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';

    const manager = new BilibiliDanmuManager();

    manager.onSubtitleVisible();
    expect(document.getElementById('lexipath-hide-bilibili-danmu')).toBeTruthy();

    manager.onSubtitleHidden();
    vi.advanceTimersByTime(2999);
    expect(document.getElementById('lexipath-hide-bilibili-danmu')).toBeTruthy();

    vi.advanceTimersByTime(1);
    expect(document.getElementById('lexipath-hide-bilibili-danmu')).toBeFalsy();

    manager.destroy();
    vi.useRealTimers();
  });

  it('keeps danmu hidden if a new subtitle appears before restore', () => {
    vi.useFakeTimers();
    document.head.innerHTML = '';
    document.body.innerHTML = '';

    const manager = new BilibiliDanmuManager();
    manager.onSubtitleVisible();
    manager.onSubtitleHidden();

    vi.advanceTimersByTime(1500);
    manager.onSubtitleVisible();

    vi.advanceTimersByTime(3000);
    expect(document.getElementById('lexipath-hide-bilibili-danmu')).toBeTruthy();

    manager.onSubtitleHidden();
    vi.advanceTimersByTime(3000);
    expect(document.getElementById('lexipath-hide-bilibili-danmu')).toBeFalsy();

    manager.destroy();
    vi.useRealTimers();
  });
});

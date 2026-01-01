/**
 * Subtitle Controller
 *
 * Manages subtitle fetching, enhancement, and synchronization with video playback.
 * Supports YouTube and Bilibili platforms.
 */

import type { Cue, SubtitleEnhanceOutput } from '@lexipath/core';
import {
  getVideoId as getYouTubeVideoId,
  fetchYouTubeSubtitles,
  parseVideoInfo as parseBilibiliVideoInfo,
  getCid,
  fetchBilibiliSubtitles,
  getBilibiliAvailableTracks,
} from '@lexipath/subtitles';
import { sendMessage } from '../shared/messages';
import { SubtitleOverlay, type SubtitleMode, type SubtitleLine } from './subtitle-overlay';

export type Platform = 'youtube' | 'bilibili' | 'unknown';

export interface VideoInfo {
  platform: Platform;
  videoId: string;
  extraParams?: Record<string, string>;
}

/**
 * Detect current platform from URL
 */
export function detectPlatform(url: string): Platform {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('youtube.com') || urlLower.includes('youtu.be')) {
    return 'youtube';
  }
  if (urlLower.includes('bilibili.com')) {
    return 'bilibili';
  }
  return 'unknown';
}

/**
 * Extract video information from URL
 */
export async function extractVideoInfo(url: string): Promise<VideoInfo | null> {
  const platform = detectPlatform(url);

  switch (platform) {
    case 'youtube': {
      const videoId = getYouTubeVideoId(url);
      if (!videoId) return null;
      return { platform, videoId };
    }

    case 'bilibili': {
      const info = parseBilibiliVideoInfo(url);
      if (!info) return null;

      let cid = info.cid;
      if (!cid) {
        try {
          cid = await getCid(info.bvid);
        } catch (error) {
          console.error('[SubtitleController] Failed to get cid:', error);
          return null;
        }
      }

      return {
        platform,
        videoId: info.bvid,
        extraParams: { cid },
      };
    }

    default:
      return null;
  }
}

/**
 * Subtitle Controller
 */
export class SubtitleController {
  private videoInfo: VideoInfo | null = null;
  private overlay: SubtitleOverlay | null = null;
  private cues: Cue[] = [];
  private enhancedCues: Map<string, SubtitleEnhanceOutput> = new Map();
  private currentCueIndex: number = -1;
  private videoElement: HTMLVideoElement | null = null;
  private rafId: number | null = null;
  private mode: SubtitleMode = 'enhanced';
  private tempBilingualKeyPressed: boolean = false;

  /**
   * Initialize controller
   */
  async init(url: string): Promise<boolean> {
    // Detect platform and extract video info
    this.videoInfo = await extractVideoInfo(url);
    if (!this.videoInfo || this.videoInfo.platform === 'unknown') {
      console.log('[SubtitleController] Unsupported platform or invalid URL');
      return false;
    }

    console.log('[SubtitleController] Video info:', this.videoInfo);

    // Find video element
    this.videoElement = this.findVideoElement();
    if (!this.videoElement) {
      console.error('[SubtitleController] Video element not found');
      return false;
    }

    // Create overlay
    this.overlay = new SubtitleOverlay(this.videoInfo.platform, {
      onModeChange: (mode) => {
        this.mode = mode;
        this.updateSubtitleDisplay();
      },
    });

    // Mount overlay
    const mounted = this.overlay.mount();
    if (!mounted) {
      console.error('[SubtitleController] Failed to mount overlay');
      return false;
    }

    // Fetch subtitles
    await this.fetchAndProcessSubtitles();

    // Start sync loop
    this.startSync();

    // Setup keyboard listener for temporary bilingual mode
    this.setupKeyboardListener();

    console.log('[SubtitleController] Initialized successfully');
    return true;
  }

  /**
   * Destroy controller and cleanup
   */
  destroy(): void {
    this.stopSync();
    this.overlay?.unmount();
    this.overlay = null;
    this.videoElement = null;
    this.cues = [];
    this.enhancedCues.clear();
    this.currentCueIndex = -1;
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
  }

  /**
   * Fetch subtitles and process them
   */
  private async fetchAndProcessSubtitles(): Promise<void> {
    if (!this.videoInfo) return;

    try {
      // Fetch subtitles based on platform
      let cues: Cue[] = [];

      if (this.videoInfo.platform === 'youtube') {
        // Fetch English subtitles for YouTube
        cues = await fetchYouTubeSubtitles(this.videoInfo.videoId, 'en');
      } else if (this.videoInfo.platform === 'bilibili') {
        // Fetch subtitles for Bilibili
        const cid = this.videoInfo.extraParams?.cid;
        if (!cid) {
          console.error('[SubtitleController] Missing cid for Bilibili');
          return;
        }

        const tracks = await getBilibiliAvailableTracks(this.videoInfo.videoId, cid);
        if (tracks.length === 0) {
          console.log('[SubtitleController] No subtitle tracks found');
          return;
        }

        // Use first available track (or prefer English if available)
        const englishTrack = tracks.find((t) => t.languageCode.toLowerCase().includes('en'));
        const track = englishTrack || tracks[0];

        if (!track) return;
        cues = await fetchBilibiliSubtitles(track.url);
      }

      this.cues = cues;
      console.log(`[SubtitleController] Fetched ${cues.length} subtitle cues`);

      // Pre-enhance all subtitles
      await this.enhanceAllSubtitles();
    } catch (error) {
      console.error('[SubtitleController] Failed to fetch subtitles:', error);
    }
  }

  /**
   * Enhance all subtitles
   */
  private async enhanceAllSubtitles(): Promise<void> {
    console.log('[SubtitleController] Enhancing subtitles...');

    for (const cue of this.cues) {
      try {
        const response = await sendMessage('ENHANCE_SUBTITLE', {
          text: cue.text,
          lang: cue.lang,
        });

        if (response.ok) {
          this.enhancedCues.set(cue.id, response.value);
        } else {
          console.warn(`[SubtitleController] Failed to enhance cue ${cue.id}:`, response.error);
        }
      } catch (error) {
        console.error(`[SubtitleController] Error enhancing cue ${cue.id}:`, error);
      }
    }

    console.log(`[SubtitleController] Enhanced ${this.enhancedCues.size} / ${this.cues.length} cues`);
  }

  /**
   * Find video element on page
   */
  private findVideoElement(): HTMLVideoElement | null {
    const video = document.querySelector('video');
    return video instanceof HTMLVideoElement ? video : null;
  }

  /**
   * Start synchronization loop
   */
  private startSync(): void {
    if (this.rafId !== null) return;

    const syncLoop = () => {
      this.syncSubtitle();
      this.rafId = requestAnimationFrame(syncLoop);
    };

    this.rafId = requestAnimationFrame(syncLoop);
  }

  /**
   * Stop synchronization loop
   */
  private stopSync(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Synchronize subtitle with video time
   */
  private syncSubtitle(): void {
    if (!this.videoElement || this.cues.length === 0) return;

    const currentTimeMs = this.videoElement.currentTime * 1000;

    // Find current cue
    const cueIndex = this.cues.findIndex(
      (cue) => currentTimeMs >= cue.startMs && currentTimeMs < cue.endMs
    );

    // Update if cue changed
    if (cueIndex !== this.currentCueIndex) {
      this.currentCueIndex = cueIndex;
      this.updateSubtitleDisplay();
    }
  }

  /**
   * Update subtitle display based on current cue and mode
   */
  private updateSubtitleDisplay(): void {
    if (!this.overlay) return;

    // Clear if no current cue
    if (this.currentCueIndex < 0 || this.currentCueIndex >= this.cues.length) {
      this.overlay.clear();
      return;
    }

    const cue = this.cues[this.currentCueIndex];
    if (!cue) {
      this.overlay.clear();
      return;
    }

    const enhanced = this.enhancedCues.get(cue.id);
    const effectiveMode = this.tempBilingualKeyPressed ? 'bilingual-temp' : this.mode;

    let lines: SubtitleLine[] = [];

    if (effectiveMode === 'enhanced') {
      // Single line: enhanced only
      lines = [
        {
          text: enhanced?.line1_final || cue.text,
          isEnhanced: true,
        },
      ];
    } else {
      // Bilingual: enhanced + original
      lines = [
        {
          text: enhanced?.line1_final || cue.text,
          isEnhanced: true,
        },
        {
          text: cue.text,
          isEnhanced: false,
        },
      ];
    }

    this.overlay.display({ mode: effectiveMode, lines });
  }

  /**
   * Setup keyboard listener for temporary bilingual mode
   */
  private setupKeyboardListener(): void {
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleKeyUp = this.handleKeyUp.bind(this);
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    // Use 'c' key for temporary bilingual (can be configured later)
    if (event.key === 'c' && !this.tempBilingualKeyPressed) {
      this.tempBilingualKeyPressed = true;
      this.updateSubtitleDisplay();
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'c' && this.tempBilingualKeyPressed) {
      this.tempBilingualKeyPressed = false;
      this.updateSubtitleDisplay();
    }
  };
}

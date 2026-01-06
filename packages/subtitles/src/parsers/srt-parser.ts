import type { Cue, CueSource } from '@lexipath/core';
import { parseTimeToMs } from './time';

function parseSrtTime(time: string): number {
  return parseTimeToMs(time);
}

export function parseSrt(input: string, options?: { lang?: string; source?: CueSource }): Cue[] {
  const normalized = input.replace(/\r/g, '').trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n\s*\n/).filter(Boolean);
  const cues: Cue[] = [];
  const lang = options?.lang ?? 'und';
  const source = options?.source ?? 'generic';

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 2) continue;

    const timeLineIndex = lines.findIndex((line) => line.includes('-->'));
    if (timeLineIndex === -1) continue;
    const timeLine = lines[timeLineIndex] ?? '';

    const match = timeLine.match(/^(.+?)\s+-->\s+(.+?)\s*$/);
    if (!match?.[1] || !match[2]) continue;

    const startMs = parseSrtTime(match[1]);
    const endMs = parseSrtTime(match[2]);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;

    const text = lines
      .slice(timeLineIndex + 1)
      .join('\n')
      .trim();
    if (!text) continue;

    cues.push({
      id: `srt:${startMs}-${endMs}:${cues.length}`,
      startMs,
      endMs,
      text,
      lang,
      source,
    });
  }

  return cues;
}


import type { Cue, CueSource } from '@lexipath/core';
import { parseTimeToMs } from './time';

function parseSrtTime(time: string): number {
  return parseTimeToMs(time);
}

export function parseSrt(input: string, options?: { lang?: string; source?: CueSource }): Cue[] {
  const normalized = input.replace(/\r/g, '').trim();
  if (!normalized) return [];

  const lines = normalized.split('\n');
  const cues: Cue[] = [];
  const lang = options?.lang ?? 'und';
  const source = options?.source ?? 'generic';

  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? '').trim();
    if (!line) {
      i += 1;
      continue;
    }

    // Optional numeric cue identifier line.
    if (/^\d+$/.test(line)) {
      i += 1;
    }

    const candidate = (lines[i] ?? '').trim();
    const timeLine = candidate.includes('-->') ? candidate : (lines[i + 1] ?? '').trim();
    const timeLineIndex = candidate.includes('-->') ? i : i + 1;
    if (!timeLine.includes('-->')) {
      i += 1;
      continue;
    }

    const match = timeLine.match(/^(.+?)\s+-->\s+(.+?)\s*$/);
    if (!match?.[1] || !match[2]) {
      i = timeLineIndex + 1;
      continue;
    }

    const startMs = parseSrtTime(match[1]);
    const endMs = parseSrtTime(match[2]);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      i = timeLineIndex + 1;
      continue;
    }

    i = timeLineIndex + 1;
    const textLines: string[] = [];
    while (i < lines.length) {
      const textLine = lines[i];
      if (textLine === undefined) break;
      if (!textLine.trim()) break;
      textLines.push(textLine);
      i += 1;
    }

    const text = textLines.join('\n').trim();
    if (!text) {
      i += 1;
      continue;
    }

    cues.push({
      id: `srt:${startMs}-${endMs}:${cues.length}`,
      startMs,
      endMs,
      text,
      lang,
      source,
    });

    i += 1;
  }

  return cues;
}

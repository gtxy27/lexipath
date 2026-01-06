import type { Cue, CueSource } from '@lexipath/core';
import { parseTimeToMs } from './time';

function stripWebVttTags(text: string): string {
  return text
    .replace(/<v\s+[^>]+>/g, '')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

function isTimeLine(line: string): boolean {
  return line.includes('-->');
}

function parseVttTime(time: string): number {
  return parseTimeToMs(time);
}

export function parseWebVtt(input: string, options?: { lang?: string; source?: CueSource }): Cue[] {
  const lines = input.replace(/\r/g, '').split('\n');
  const cues: Cue[] = [];
  const lang = options?.lang ?? 'und';
  const source = options?.source ?? 'generic';

  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] ?? '').trim();

    if (!line || line === 'WEBVTT' || line.startsWith('NOTE')) {
      i += 1;
      continue;
    }

    // Optional cue identifier line.
    const timeLine = isTimeLine(line) ? line : (lines[i + 1] ?? '').trim();
    if (!isTimeLine(timeLine)) {
      i += 1;
      continue;
    }

    const match = timeLine.match(/^(.+?)\s+-->\s+(.+?)(\s+.*)?$/);
    if (!match?.[1] || !match[2]) {
      i += 1;
      continue;
    }

    const startMs = parseVttTime(match[1]);
    const endMs = parseVttTime(match[2]);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      i += 1;
      continue;
    }

    // Advance to the text line (skip id if present).
    i = isTimeLine(line) ? i + 1 : i + 2;

    const textLines: string[] = [];
    while (i < lines.length) {
      const candidate = lines[i];
      if (candidate === undefined) break;
      if (!candidate.trim()) break;
      textLines.push(candidate);
      i += 1;
    }

    const rawText = textLines.join('\n').trim();
    const text = stripWebVttTags(rawText);
    if (!text) {
      i += 1;
      continue;
    }

    cues.push({
      id: `webvtt:${startMs}-${endMs}:${cues.length}`,
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


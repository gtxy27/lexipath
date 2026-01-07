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
  const normalized = input.replace(/\r/g, '');
  const cues: Cue[] = [];
  const lang = options?.lang ?? 'und';
  const source = options?.source ?? 'generic';

  let offset = 0;
  let bufferedLine: string | null = null;

  const readNextLine = (): string | null => {
    if (offset >= normalized.length) return null;
    const nextNewline = normalized.indexOf('\n', offset);
    if (nextNewline === -1) {
      const last = normalized.slice(offset);
      offset = normalized.length;
      return last;
    }
    const line = normalized.slice(offset, nextNewline);
    offset = nextNewline + 1;
    return line;
  };

  const peekLine = (): string | null => {
    if (bufferedLine === null) bufferedLine = readNextLine();
    return bufferedLine;
  };

  const consumeLine = (): string | null => {
    const line = peekLine();
    bufferedLine = null;
    return line;
  };

  while (true) {
    const raw = consumeLine();
    if (raw === null) break;
    const line = raw.trim();

    if (!line || line === 'WEBVTT' || line.startsWith('NOTE')) {
      continue;
    }

    // Optional cue identifier line.
    const timeLine = isTimeLine(line) ? line : (peekLine() ?? '').trim();
    if (!isTimeLine(timeLine)) {
      continue;
    }

    if (!isTimeLine(line)) {
      consumeLine();
    }

    const match = timeLine.match(/^(.+?)\s+-->\s+(.+?)(\s+.*)?$/);
    if (!match?.[1] || !match[2]) {
      continue;
    }

    const startMs = parseVttTime(match[1]);
    const endMs = parseVttTime(match[2]);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      continue;
    }

    const textLines: string[] = [];
    while (true) {
      const candidate = peekLine();
      if (candidate === null) break;
      if (!candidate.trim()) {
        consumeLine();
        break;
      }
      textLines.push(consumeLine() ?? '');
    }

    const rawText = textLines.join('\n').trim();
    const text = stripWebVttTags(rawText);
    if (!text) {
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
  }

  return cues;
}

import type { Cue, CueSource } from '@lexipath/core';
import { parseTimeToMs } from './time';

function getTextWithBreaks(node: Element): string {
  const parts: string[] = [];

  const walk = (current: Node) => {
    if (current.nodeType === Node.TEXT_NODE) {
      const value = current.textContent ?? '';
      if (value) parts.push(value);
      return;
    }

    if (current.nodeType !== Node.ELEMENT_NODE) return;

    const el = current as Element;
    if (el.tagName.toLowerCase() === 'br') {
      parts.push('\n');
      return;
    }

    for (const child of Array.from(el.childNodes)) {
      walk(child);
    }
  };

  walk(node);

  return parts
    .join('')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseTtmlTime(value: string): number {
  return parseTimeToMs(value);
}

export function parseTtml(input: string, options?: { lang?: string; source?: CueSource }): Cue[] {
  const raw = input.trim();
  if (!raw) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'text/xml');

  const cues: Cue[] = [];
  const lang = options?.lang ?? 'und';
  const source = options?.source ?? 'generic';

  const pElements = Array.from(doc.querySelectorAll('p'));

  for (const p of pElements) {
    const begin = p.getAttribute('begin');
    const end = p.getAttribute('end');
    const dur = p.getAttribute('dur');

    if (!begin) continue;
    const startMs = parseTtmlTime(begin);
    const endMs = end ? parseTtmlTime(end) : dur ? startMs + parseTtmlTime(dur) : 0;

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;

    const text = getTextWithBreaks(p);
    if (!text) continue;

    cues.push({
      id: `ttml:${startMs}-${endMs}:${cues.length}`,
      startMs,
      endMs,
      text,
      lang,
      source,
    });
  }

  return cues;
}


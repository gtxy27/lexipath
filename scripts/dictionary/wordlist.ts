import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export type Wordlist = {
  words: string[];
  order: ReadonlyMap<string, number>;
  bucket: ReadonlyMap<string, string>;
};

function normalizeBucket(raw: string): string {
  const v = raw.trim().toUpperCase();
  if (/^N[1-5]$/.test(v)) return v;
  return v;
}

export async function loadWordlist(filePath: string): Promise<Wordlist> {
  if (!existsSync(filePath)) {
    return { words: [], order: new Map(), bucket: new Map() };
  }

  const raw = await readFile(filePath, "utf8");

  const words: string[] = [];
  const order = new Map<string, number>();
  const bucket = new Map<string, string>();

  let currentBucket: string | null = null;

  for (const line of raw.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("#")) {
      const token = trimmed.replace(/^#+\s*/, "");
      const m = token.match(/\b(N[1-5])\b/i);
      if (m?.[1]) {
        currentBucket = normalizeBucket(m[1]);
      }
      continue;
    }

    // Support explicit bucket prefixes like:
    // - "N5 ありがとう"
    // - "N5:ありがとう"
    // - "N5\tありがとう"
    const prefixed = trimmed.match(/^(N[1-5])\s*[:\t ]\s*(.+)$/i);
    const nextBucket = prefixed?.[1] ? normalizeBucket(prefixed[1]) : currentBucket;
    const word = (prefixed?.[2] ?? trimmed).trim();
    if (!word) continue;

    if (!order.has(word)) {
      order.set(word, words.length);
      words.push(word);
    }

    if (nextBucket && !bucket.has(word)) {
      bucket.set(word, nextBucket);
    }
  }

  return { words, order, bucket };
}

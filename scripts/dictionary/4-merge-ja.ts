import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { processedDir } from "./paths";

type WordsJaEntry = {
  word: string;
  pos?: string;
  reading?: string;
};

type JmdictEntry = {
  word: string;
  reading?: string;
  pos?: string[];
};

function readJsonArray<T>(raw: string): T[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
  return parsed as T[];
}

export async function mergeJmdictIntoWordsJa(): Promise<{ merged: number; skippedReason?: string }> {
  const wordsJaPath = path.join(processedDir, "words_ja.json");
  const jmdictPath = path.join(processedDir, "jmdict_ja.json");
  if (!existsSync(wordsJaPath)) return { merged: 0, skippedReason: `missing ${wordsJaPath}` };
  if (!existsSync(jmdictPath)) return { merged: 0, skippedReason: `missing ${jmdictPath}` };

  const wordsRaw = await readFile(wordsJaPath, "utf8");
  const dictRaw = await readFile(jmdictPath, "utf8");
  const words = readJsonArray<WordsJaEntry>(wordsRaw);
  const dict = readJsonArray<JmdictEntry>(dictRaw);

  const byWord = new Map<string, JmdictEntry>();
  for (const entry of dict) {
    if (!entry?.word) continue;
    if (!byWord.has(entry.word)) byWord.set(entry.word, entry);
  }

  let merged = 0;
  const next = words.map((w) => {
    const match = byWord.get(w.word);
    if (!match) return w;
    const reading = match.reading || w.reading;
    const pos = w.pos || match.pos?.[0];
    if (reading !== w.reading || pos !== w.pos) merged += 1;
    return { ...w, ...(reading ? { reading } : {}), ...(pos ? { pos } : {}) };
  });

  await writeFile(wordsJaPath, JSON.stringify(next) + "\n", "utf8");
  return { merged };
}


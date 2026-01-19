import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { processedDir } from "./paths";

type AnyObject = Record<string, unknown>;

type RawWordEntry = AnyObject & { word: string; frequency?: number | undefined };


type NormalizedWordEntry = AnyObject & { id: number; word: string; frequency?: number };

type RawWordPair = { fromWord: string; toWord: string };

type Lang = "en" | "zh" | "ja" | "ko";

type WordTable = {
  lang: Lang;
  rawByWord: Map<string, RawWordEntry>;
};

function readJsonArray<T>(raw: string): T[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
  return parsed as T[];
}

function stableWordSort(a: string, b: string): number {
  // Deterministic IDs across builds: lexical order only.
  return a.localeCompare(b);
}

function mergeWordEntry(base: RawWordEntry, next: RawWordEntry): RawWordEntry {
  // Prefer existing non-empty fields, but keep max frequency.
  const out: RawWordEntry = { ...next, ...base, word: base.word };
  const f1 = typeof base.frequency === "number" ? base.frequency : 0;
  const f2 = typeof next.frequency === "number" ? next.frequency : 0;
  out.frequency = Math.max(f1, f2) || undefined;
  return out;
}

async function loadWordsFile(lang: Lang): Promise<WordTable | null> {
  const filePath = path.join(processedDir, `words_${lang}.json`);
  if (!existsSync(filePath)) return null;
  const raw = await readFile(filePath, "utf8");
  const rows = readJsonArray<AnyObject>(raw);

  const rawByWord = new Map<string, RawWordEntry>();

  for (const row of rows) {
    const word = typeof row?.word === "string" ? row.word : "";
    if (!word) continue;
    const entry = row as RawWordEntry;
    const prev = rawByWord.get(word);
    rawByWord.set(word, prev ? mergeWordEntry(prev, entry) : entry);
  }

  return { lang, rawByWord };
}

function ensureWord(table: WordTable, word: string): void {
  if (!word) return;
  if (table.rawByWord.has(word)) return;
  table.rawByWord.set(word, { word, frequency: 0 });
}

async function loadMappingPairs(from: Lang, to: Lang): Promise<RawWordPair[] | null> {
  const filePath = path.join(processedDir, `${from}_${to}.json`);
  if (!existsSync(filePath)) return null;

  const raw = await readFile(filePath, "utf8");
  const rows = readJsonArray<AnyObject>(raw);

  const fromKey = `${from}_word`;
  const toKey = `${to}_word`;

  const pairs: RawWordPair[] = [];

  for (const row of rows) {
    const fromWord = typeof row?.[fromKey] === "string" ? (row[fromKey] as string) : "";
    const toWord = typeof row?.[toKey] === "string" ? (row[toKey] as string) : "";
    if (!fromWord || !toWord) continue;
    pairs.push({ fromWord, toWord });
  }

  return pairs;
}

function assignIds(table: WordTable): {
  wordToId: Map<string, number>;
  idToWord: Map<number, string>;
  idToFreq: Map<number, number>;
  entries: NormalizedWordEntry[];
} {
  const words = [...table.rawByWord.keys()].sort(stableWordSort);
  const wordToId = new Map<string, number>();
  const idToWord = new Map<number, string>();
  const idToFreq = new Map<number, number>();

  const entries: NormalizedWordEntry[] = [];

  let id = 1;
  for (const word of words) {
    const raw = table.rawByWord.get(word)!;
    // Strip any existing id before adding ours.
    const { id: _ignored, ...rest } = raw as AnyObject & { id?: unknown };
    const normalized: NormalizedWordEntry = { ...rest, word, id } as NormalizedWordEntry;

    wordToId.set(word, id);
    idToWord.set(id, word);

    const freq = typeof raw.frequency === "number" && Number.isFinite(raw.frequency) ? raw.frequency : 0;
    if (freq > 0) idToFreq.set(id, freq);

    entries.push(normalized);
    id += 1;
  }

  return { wordToId, idToWord, idToFreq, entries };
}

type RankedMapping = {
  from_id: number;
  to_id: number;
  [rankField: string]: number;
};

function computeRankedMappings(options: {
  from: Lang;
  to: Lang;
  pairs: RawWordPair[];
  fromWordToId: Map<string, number>;
  toWordToId: Map<string, number>;
  fromIdToWord: Map<number, string>;
  toIdToWord: Map<number, string>;
  fromIdToFreq: Map<number, number>;
  toIdToFreq: Map<number, number>;
}): RankedMapping[] {
  const rankFromField = `rank_${options.from}`;
  const rankToField = `rank_${options.to}`;

  // Deduplicate edges.
  const edgeSet = new Set<string>();
  const edges: Array<{ fromId: number; toId: number }> = [];

  for (const p of options.pairs) {
    const fromId = options.fromWordToId.get(p.fromWord);
    const toId = options.toWordToId.get(p.toWord);
    if (!fromId || !toId) continue;
    const key = `${fromId}:${toId}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    edges.push({ fromId, toId });
  }

  const byFrom = new Map<number, number[]>();
  const byTo = new Map<number, number[]>();
  for (const e of edges) {
    const a = byFrom.get(e.fromId);
    if (a) a.push(e.toId);
    else byFrom.set(e.fromId, [e.toId]);

    const b = byTo.get(e.toId);
    if (b) b.push(e.fromId);
    else byTo.set(e.toId, [e.fromId]);
  }

  const fromRanks = new Map<string, number>();
  for (const [fromId, toIds] of byFrom.entries()) {
    const sorted = [...new Set(toIds)].sort((a, b) => {
      const fa = options.toIdToFreq.get(a) ?? 0;
      const fb = options.toIdToFreq.get(b) ?? 0;
      if (fa !== fb) return fb - fa;
      const wa = options.toIdToWord.get(a) ?? "";
      const wb = options.toIdToWord.get(b) ?? "";
      return wa.localeCompare(wb);
    });

    for (let i = 0; i < sorted.length; i += 1) {
      fromRanks.set(`${fromId}:${sorted[i]!}`, i);
    }
  }

  const toRanks = new Map<string, number>();
  for (const [toId, fromIds] of byTo.entries()) {
    const sorted = [...new Set(fromIds)].sort((a, b) => {
      const fa = options.fromIdToFreq.get(a) ?? 0;
      const fb = options.fromIdToFreq.get(b) ?? 0;
      if (fa !== fb) return fb - fa;
      const wa = options.fromIdToWord.get(a) ?? "";
      const wb = options.fromIdToWord.get(b) ?? "";
      return wa.localeCompare(wb);
    });

    for (let i = 0; i < sorted.length; i += 1) {
      toRanks.set(`${sorted[i]!}:${toId}`, i);
    }
  }

  const out: RankedMapping[] = [];
  for (const e of edges) {
    const k = `${e.fromId}:${e.toId}`;
    const rFrom = fromRanks.get(k) ?? 0;
    const rTo = toRanks.get(k) ?? 0;
    out.push({ from_id: e.fromId, to_id: e.toId, [rankFromField]: rFrom, [rankToField]: rTo });
  }

  out.sort((a, b) => a.from_id - b.from_id || a[rankFromField]! - b[rankFromField]! || a.to_id - b.to_id);
  return out;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(value) + "\n", "utf8");
}

export async function normalizeProcessedArtifacts(options: {
  includeJa: boolean;
  includeKo: boolean;
}): Promise<void> {
  const langs: Lang[] = ["en", "zh", "ja", "ko"];

  const tables = new Map<Lang, WordTable>();
  for (const lang of langs) {
    if (lang === "ja" && !options.includeJa) continue;
    if (lang === "ko" && !options.includeKo) continue;

    const loaded = await loadWordsFile(lang);
    if (loaded) tables.set(lang, loaded);
  }

  const requiredPairs: Array<[Lang, Lang]> = [
    ["en", "zh"],
    ["ja", "zh"],
    ["ko", "zh"],
  ];

  const pairData = new Map<string, RawWordPair[]>();

  for (const [from, to] of requiredPairs) {
    if (from === "ja" && !options.includeJa) continue;
    if (from === "ko" && !options.includeKo) continue;

    const pairs = await loadMappingPairs(from, to);
    if (!pairs) continue;

    // Ensure word tables exist and include all referenced words.
    const fromTable = tables.get(from) ?? { lang: from, rawByWord: new Map() };
    const toTable = tables.get(to) ?? { lang: to, rawByWord: new Map() };

    for (const p of pairs) {
      ensureWord(fromTable, p.fromWord);
      ensureWord(toTable, p.toWord);
    }

    tables.set(from, fromTable);
    tables.set(to, toTable);

    pairData.set(`${from}_${to}`, pairs);
  }

  // Assign deterministic IDs per language (lexical order only).
  const assigned = new Map<Lang, ReturnType<typeof assignIds>>();
  for (const [lang, table] of tables.entries()) {
    assigned.set(lang, assignIds(table));
  }

  // Write normalized word tables.
  for (const [lang, data] of assigned.entries()) {
    const filePath = path.join(processedDir, `words_${lang}.json`);
    await writeJson(filePath, data.entries);
  }

  // Write ranked mapping tables.
  for (const [key, pairs] of pairData.entries()) {
    const [from, to] = key.split("_") as [Lang, Lang];
    const fromData = assigned.get(from);
    const toData = assigned.get(to);
    if (!fromData || !toData) continue;

    const ranked = computeRankedMappings({
      from,
      to,
      pairs,
      fromWordToId: fromData.wordToId,
      toWordToId: toData.wordToId,
      fromIdToWord: fromData.idToWord,
      toIdToWord: toData.idToWord,
      fromIdToFreq: fromData.idToFreq,
      toIdToFreq: toData.idToFreq,
    });

    const filePath = path.join(processedDir, `${from}_${to}.json`);
    await writeJson(filePath, ranked);
  }
}

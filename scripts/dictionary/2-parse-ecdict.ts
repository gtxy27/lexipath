import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { processedDir, rawDir } from "./paths";
import { ensureDir } from "./fs";
import { readLinesFromStream } from "./lines";
import { parseCsvRow } from "./csv";
import { createJsonArrayFileWriter } from "./json";
import { parseArgs, getNumberArg } from "./args";

type EcdictRow = {
  word: string;
  phonetic?: string | undefined;
  translation?: string | undefined;
  pos?: string | undefined;
  tag?: string | undefined;
  frq?: number | undefined;
};

function parseDifficulty(row: EcdictRow): string | undefined {
  const tag = (row.tag ?? "").toLowerCase();
  if (tag.includes("cet4")) return "A2";
  if (tag.includes("cet6")) return "B1";
  if (tag.includes("ielts") || tag.includes("toefl")) return "B2";
  return undefined;
}

function stripPosPrefix(s: string): string {
  // Remove POS prefixes like "n.", "vt.", "pron." at the start of a line/token.
  // Also handle bracketed cases like "[n. xxx".
  return s.replace(/^\s*\[?\s*[a-z]{1,6}\.(?=\s)/i, '').trim();
}

function cleanZhToken(raw: string): string {
  const s = raw
    .replace(/\s+/g, ' ')
    .replace(/^\s*[0-9]+\s*[.)]\s*/g, '')
    .trim();

  // Some ECDICT entries include English morphology notes like "(ginger 的过去分词) n. 姜".
  // For offline targets, keep only the trailing Chinese token part.
  const afterParens = s.includes(')') ? s.split(')').slice(-1)[0]!.trim() : s;

  // Remove any POS prefix even if it's not at the very start of the original string.
  return stripPosPrefix(afterParens);
}

function splitZhTranslations(raw: string): string[] {
  // The ECDICT translation field often mixes multiple POS blocks separated by newlines.
  // We want plain target tokens only, not multi-line "n./v." annotated blocks.
  const normalized = raw
    .replace(/[\uFF1B;]/g, ';')
    // ECDICT sometimes encodes newlines as literal "\\n" sequences inside the CSV field.
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n');

  const lines = normalized
    .split(/\r?\n/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(stripPosPrefix);

  const tokens: string[] = [];
  for (const line of lines) {
    if (!line) continue;

    for (const part of line.split(';')) {
      for (const piece of part.split(/[，,]/g)) {
        const cleaned = cleanZhToken(piece.replace(/^["“”]+|["“”]+$/g, ''));
        if (cleaned) tokens.push(cleaned);
      }
    }
  }

  return tokens;
}

function pickFrequency(frqRaw: string | undefined): number | undefined {
  if (!frqRaw) return undefined;
  const num = Number(frqRaw);
  if (!Number.isFinite(num)) return undefined;
  return num;
}

async function* iterateEcdict(filePath: string): AsyncGenerator<{ header: string[] } | { row: EcdictRow }> {
  const input = createReadStream(filePath);
  let header: string[] | null = null;
  for await (const line of readLinesFromStream(input)) {
    if (!line.trim()) continue;
    const cells = parseCsvRow(line);
    if (!header) {
      header = cells.map((s) => s.trim());
      yield { header };
      continue;
    }

    const get = (name: string): string | undefined => {
      const idx = header!.indexOf(name);
      if (idx < 0) return undefined;
      return cells[idx];
    };

    const word = (get("word") ?? "").trim();
    if (!word) continue;

    yield {
      row: {
        word,
        phonetic: (get("phonetic") ?? "").trim() || undefined,
        translation: (get("translation") ?? "").trim() || undefined,
        pos: (get("pos") ?? "").trim() || undefined,
        tag: (get("tag") ?? "").trim() || undefined,
        frq: pickFrequency(get("frq")),
      },
    };
  }
}

type HeapItem = { word: string; frq: number };

class MinHeap {
  private items: HeapItem[] = [];

  get size(): number {
    return this.items.length;
  }

  peek(): HeapItem | undefined {
    return this.items[0];
  }

  push(item: HeapItem): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): HeapItem | undefined {
    if (this.items.length === 0) return undefined;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  toSortedDescending(): HeapItem[] {
    return [...this.items].sort((a, b) => b.frq - a.frq || a.word.localeCompare(b.word));
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent]!.frq <= this.items[index]!.frq) break;
      [this.items[parent], this.items[index]] = [this.items[index]!, this.items[parent]!];
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    while (true) {
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      let smallest = index;
      if (left < this.items.length && this.items[left]!.frq < this.items[smallest]!.frq) smallest = left;
      if (right < this.items.length && this.items[right]!.frq < this.items[smallest]!.frq) smallest = right;
      if (smallest === index) break;
      [this.items[smallest], this.items[index]] = [this.items[index]!, this.items[smallest]!];
      index = smallest;
    }
  }
}

export type ParseEcdictResult = {
  enCount: number;
  mappingCount: number;
  zhCounts: Map<string, number>;
};

export async function parseEcdict(options: { limit: number }): Promise<ParseEcdictResult> {
  const inputPath = path.join(rawDir, "ecdict.csv");
  if (!existsSync(inputPath)) {
    throw new Error(`[dict] missing input: ${inputPath}. Run dict:download first.`);
  }

  await ensureDir(processedDir);
  const wordsEnPath = path.join(processedDir, "words_en.json");
  const enZhPath = path.join(processedDir, "en_zh.json");

  process.stdout.write(`[dict] parse ECDICT (top ${options.limit})\n`);

  // Pass 1: select top-N by frq without holding all rows in memory.
  const heap = new MinHeap();
  for await (const item of iterateEcdict(inputPath)) {
    if ("header" in item) continue;
    const frq = item.row.frq ?? 0;
    if (frq <= 0) continue;
    const key = item.row.word.toLowerCase();
    if (heap.size < options.limit) {
      heap.push({ word: key, frq });
      continue;
    }
    const min = heap.peek();
    if (min && frq > min.frq) {
      heap.pop();
      heap.push({ word: key, frq });
    }
  }

  const selected = new Set(heap.toSortedDescending().map((x) => x.word));
  process.stdout.write(`[dict] selected en words: ${selected.size}\n`);

  // Pass 2: emit records for selected words.
  const { writer: enWriter, close: closeEn } = await createJsonArrayFileWriter(wordsEnPath);
  const { writer: mappingWriter, close: closeMapping } = await createJsonArrayFileWriter(enZhPath);
  const zhCounts = new Map<string, number>();

  for await (const item of iterateEcdict(inputPath)) {
    if ("header" in item) continue;
    const key = item.row.word.toLowerCase();
    if (!selected.has(key)) continue;

    enWriter.write({
      word: key,
      phonetic: item.row.phonetic,
      pos: item.row.pos,
      frequency: item.row.frq ?? undefined,
      difficulty: parseDifficulty(item.row),
    });

    const translations = item.row.translation ? splitZhTranslations(item.row.translation) : [];
    for (const zhWord of translations) {
      mappingWriter.write({ en_word: key, zh_word: zhWord });
      zhCounts.set(zhWord, (zhCounts.get(zhWord) ?? 0) + 1);
    }
  }

  const enCount = await closeEn();
  const mappingCount = await closeMapping();

  process.stdout.write(`[dict] wrote ${enCount} words_en, ${mappingCount} en_zh mappings\n`);
  return { enCount, mappingCount, zhCounts };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const limit = getNumberArg(args, "limit") ?? 100_000;
  await ensureDir(processedDir);
  await parseEcdict({ limit });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

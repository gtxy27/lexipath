import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { processedDir, rawDir, wordlistsDir } from "./paths";
import { ensureDir } from "./fs";
import { readLinesFromStream } from "./lines";
import { createJsonArrayFileWriter } from "./json";
import { loadWordlist } from "./wordlist";
import { parseArgs, getBooleanArg } from "./args";

type JmdictEntry = {
  word: string;
  reading?: string;
  pos?: string[];
};

function uniq<T>(values: T[]): T[] {
  const set = new Set(values);
  return [...set];
}

function extractAll(text: string, re: RegExp): string[] {
  const result: string[] = [];
  for (const match of text.matchAll(re)) {
    const value = match[1];
    if (typeof value === "string") result.push(value.trim());
  }
  return result.filter(Boolean);
}

function parseEntryXml(entryXml: string): { headwords: string[]; readings: string[]; pos: string[] } {
  const headwords = uniq([
    ...extractAll(entryXml, /<keb>([^<]+)<\/keb>/g),
    ...extractAll(entryXml, /<reb>([^<]+)<\/reb>/g),
  ]);
  const readings = uniq(extractAll(entryXml, /<reb>([^<]+)<\/reb>/g));
  const pos = uniq(
    extractAll(entryXml, /<pos>&([^;]+);<\/pos>/g).map((s) => s.replace(/^&|;$/g, "")),
  );
  return { headwords, readings, pos };
}

export type ParseJmdictResult = {
  wordCount: number;
  skippedReason?: string;
};

export async function parseJmdict(options: { useWordlist: boolean; wordlistPath: string }): Promise<ParseJmdictResult> {
  const inputPath = path.join(rawDir, "JMdict_e.gz");
  if (!existsSync(inputPath)) {
    return { wordCount: 0, skippedReason: `missing input: ${inputPath} (run dict:download)` };
  }

  const wordlist = options.useWordlist ? await loadWordlist(options.wordlistPath) : new Set<string>();
  if (options.useWordlist && wordlist.size === 0) {
    return { wordCount: 0, skippedReason: `empty/missing wordlist: ${options.wordlistPath}` };
  }

  if (!options.useWordlist) {
    return {
      wordCount: 0,
      skippedReason: "JMdict parsing without wordlist is disabled (would be too large).",
    };
  }

  await ensureDir(processedDir);
  const outPath = path.join(processedDir, "jmdict_ja.json");
  const { writer, close } = await createJsonArrayFileWriter(outPath);

  process.stdout.write(`[dict] parse JMdict (wordlist=${wordlist.size})\n`);

  const input = createReadStream(inputPath).pipe(createGunzip());
  let inEntry = false;
  let buffer = "";
  let count = 0;

  for await (const line of readLinesFromStream(input)) {
    if (!inEntry) {
      const startIndex = line.indexOf("<entry>");
      if (startIndex < 0) continue;
      inEntry = true;
      buffer = line.slice(startIndex) + "\n";
      continue;
    }

    buffer += line + "\n";

    const endIndex = buffer.indexOf("</entry>");
    if (endIndex < 0) continue;

    const entryXml = buffer.slice(0, endIndex + "</entry>".length);
    buffer = "";
    inEntry = false;

    const parsed = parseEntryXml(entryXml);
    if (parsed.headwords.length === 0) continue;

    const reading = parsed.readings[0];
    const pos = parsed.pos.length ? parsed.pos : undefined;

    for (const word of parsed.headwords) {
      if (!wordlist.has(word)) continue;
      const entry: JmdictEntry = { word, ...(reading ? { reading } : {}), ...(pos ? { pos } : {}) };
      writer.write(entry);
      count += 1;
    }
  }

  const wordCount = await close();
  process.stdout.write(`[dict] wrote ${wordCount} jmdict_ja entries\n`);
  return { wordCount };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const useWordlist = !getBooleanArg(args, "no-wordlist");
  await ensureDir(wordlistsDir);
  const result = await parseJmdict({
    useWordlist,
    wordlistPath: path.join(wordlistsDir, "jlpt-n5-n3.txt"),
  });
  if (result.skippedReason) process.stdout.write(`[dict] skip JMdict: ${result.skippedReason}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});


import path from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { processedDir, rawDir, wordlistsDir } from "./paths";
import { ensureDir } from "./fs";
import { readLinesFromStream } from "./lines";
import { createJsonArrayFileWriter } from "./json";
import { loadWordlist } from "./wordlist";
import { parseArgs, getBooleanArg } from "./args";

type KaikkiTranslation = { lang_code?: string; word?: string };

function normalizeLangCode(raw: string | undefined): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return "";
  if (v === "zh-hans" || v === "zh_cn" || v === "zh-cn") return "zh";
  if (v === "zh-hant" || v === "zh_tw" || v === "zh-tw") return "zh";
  return v;
}

function getTranslations(record: any): KaikkiTranslation[] {
  const translations = record?.translations;
  if (Array.isArray(translations)) return translations as KaikkiTranslation[];
  return [];
}

function getPos(record: any): string | undefined {
  const pos = record?.pos;
  return typeof pos === "string" && pos.trim() ? pos.trim() : undefined;
}

export type ParseKaikkiResult = {
  lang: "ja" | "ko";
  wordCount: number;
  mappingCount: number;
  zhCounts: Map<string, number>;
  skippedReason?: string;
};

export async function parseKaikki(options: {
  lang: "ja" | "ko";
  useWordlist: boolean;
  wordlistPath: string;
}): Promise<ParseKaikkiResult> {
  const inputPath = path.join(rawDir, `${options.lang}-extract.jsonl.gz`);
  if (!existsSync(inputPath)) {
    return {
      lang: options.lang,
      wordCount: 0,
      mappingCount: 0,
      zhCounts: new Map(),
      skippedReason: `missing input: ${inputPath} (run dict:download)`,
    };
  }

  const wordlist = options.useWordlist ? await loadWordlist(options.wordlistPath) : null;
  if (options.useWordlist && (!wordlist || wordlist.words.length === 0)) {

    return {
      lang: options.lang,
      wordCount: 0,
      mappingCount: 0,
      zhCounts: new Map(),
      skippedReason: `empty/missing wordlist: ${options.wordlistPath}`,
    };
  }

  await ensureDir(processedDir);
  const wordsPath = path.join(processedDir, `words_${options.lang}.json`);
  const mappingsPath = path.join(processedDir, `${options.lang}_zh.json`);

  process.stdout.write(
    `[dict] parse Kaikki ${options.lang.toUpperCase()} (wordlist=${options.useWordlist ? wordlist!.words.length : "OFF"})\n`,

  );

  const { writer: wordsWriter, close: closeWords } = await createJsonArrayFileWriter(wordsPath);
  const { writer: mappingWriter, close: closeMappings } = await createJsonArrayFileWriter(mappingsPath);
  const zhCounts = new Map<string, number>();
  const seen = new Set<string>();

  const input = createReadStream(inputPath).pipe(createGunzip());
  for await (const line of readLinesFromStream(input)) {
    if (!line.trim()) continue;
    let record: any;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const word = typeof record?.word === "string" ? record.word.trim() : "";
    if (!word) continue;
    if (options.useWordlist && !wordlist!.order.has(word)) continue;


    const translations = getTranslations(record)
      .map((t) => ({
        lang: normalizeLangCode(typeof t.lang_code === "string" ? t.lang_code : undefined),
        word: typeof t.word === "string" ? t.word.trim() : "",
      }))
      .filter((t) => t.lang === "zh" && t.word);

    if (translations.length === 0) continue;

    if (!seen.has(word)) {
      seen.add(word);

      let frequency: number | undefined;

      if (wordlist) {
        // KO: ordered TOPIK list (earlier = higher frequency).
        // JA: JLPT buckets (N5 > N4 > ... > N1), ties broken lexically.
        const idx = wordlist.order.get(word);
        if (typeof idx === "number") {
          const b = wordlist.bucket.get(word);
          if (options.lang === "ko") {
            // Higher numeric frequency = earlier in list.
            frequency = Math.max(0, wordlist.words.length - idx);
          } else if (options.lang === "ja") {
            const bucketWeight: Record<string, number> = { N5: 5, N4: 4, N3: 3, N2: 2, N1: 1 };
            const w = b ? (bucketWeight[b] ?? 0) : 0;
            // Spread buckets far apart; within bucket use list order to keep deterministic.
            frequency = w * 1_000_000 + Math.max(0, wordlist.words.length - idx);
          }
        }
      }

      wordsWriter.write({ word, pos: getPos(record), frequency });
    }

    for (const t of translations) {
      mappingWriter.write({ [`${options.lang}_word`]: word, zh_word: t.word });
      zhCounts.set(t.word, (zhCounts.get(t.word) ?? 0) + 1);
    }
  }

  const wordCount = await closeWords();
  const mappingCount = await closeMappings();
  process.stdout.write(`[dict] wrote ${wordCount} words_${options.lang}, ${mappingCount} ${options.lang}_zh\n`);

  return { lang: options.lang, wordCount, mappingCount, zhCounts };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const useWordlist = !getBooleanArg(args, "no-wordlist");

  await ensureDir(wordlistsDir);
  const ja = await parseKaikki({
    lang: "ja",
    useWordlist,
    wordlistPath: path.join(wordlistsDir, "jlpt-n5-n3.txt"),
  });
  const ko = await parseKaikki({
    lang: "ko",
    useWordlist,
    wordlistPath: path.join(wordlistsDir, "topik-1-2.txt"),
  });

  if (ja.skippedReason) process.stdout.write(`[dict] skip ja: ${ja.skippedReason}\n`);
  if (ko.skippedReason) process.stdout.write(`[dict] skip ko: ${ko.skippedReason}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});


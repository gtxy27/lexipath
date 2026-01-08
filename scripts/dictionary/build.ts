import path from "node:path";
import { ensureDir, copyFileStream } from "./fs";
import { processedDir, finalDir, wordlistsDir, extensionPublicDataDir } from "./paths";
import { parseArgs, getNumberArg, getBooleanArg } from "./args";
import { downloadAll } from "./1-download";
import { parseEcdict } from "./2-parse-ecdict";
import { parseKaikki } from "./2-parse-kaikki";
import { parseJmdict } from "./2-parse-jmdict";
import { writeWordsZh } from "./3-merge-zh";
import { mergeJmdictIntoWordsJa } from "./4-merge-ja";
import { compressProcessed } from "./6-compress";
import { writeManifest } from "./manifest";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const download = !getBooleanArg(args, "skip-download");
  const includeKaikki = !getBooleanArg(args, "no-kaikki");
  const includeJmdict = !getBooleanArg(args, "no-jmdict");
  const useWordlist = !getBooleanArg(args, "no-wordlist");
  const concurrency = getNumberArg(args, "download-concurrency") ?? 3;
  const enLimit = getNumberArg(args, "en-limit") ?? 100_000;

  await ensureDir(processedDir);
  await ensureDir(finalDir);
  await ensureDir(wordlistsDir);
  await ensureDir(extensionPublicDataDir);

  if (download) {
    await downloadAll({ concurrency, includeKaikki, includeJmdict });
  }

  const ecdictTask = () => parseEcdict({ limit: enLimit });
  const jaTask = () =>
    parseKaikki({
      lang: "ja",
      useWordlist,
      wordlistPath: path.join(wordlistsDir, "jlpt-n5-n3.txt"),
    });
  const koTask = () =>
    parseKaikki({
      lang: "ko",
      useWordlist,
      wordlistPath: path.join(wordlistsDir, "topik-1-2.txt"),
    });
  const jmdictTask = () =>
    parseJmdict({
      useWordlist,
      wordlistPath: path.join(wordlistsDir, "jlpt-n5-n3.txt"),
    });

  const [ecdict, ja, ko, jmdict] = await Promise.all([
    ecdictTask(),
    includeKaikki ? jaTask() : Promise.resolve(null),
    includeKaikki ? koTask() : Promise.resolve(null),
    includeKaikki && includeJmdict ? jmdictTask() : Promise.resolve(null),
  ]);

  const zhCounts = new Map<string, number>(ecdict.zhCounts);
  const counts: Record<string, number> = {
    words_en: ecdict.enCount,
    en_zh: ecdict.mappingCount,
  };

  if (ja) {

    if (!ja.skippedReason) {
      counts.words_ja = ja.wordCount;
      counts.ja_zh = ja.mappingCount;
      for (const [word, count] of ja.zhCounts.entries()) {
        zhCounts.set(word, (zhCounts.get(word) ?? 0) + count);
      }
    } else {
      process.stdout.write(`[dict] skip ja: ${ja.skippedReason}\n`);
    }
  }

  if (ko) {
    if (!ko.skippedReason) {
      counts.words_ko = ko.wordCount;
      counts.ko_zh = ko.mappingCount;
      for (const [word, count] of ko.zhCounts.entries()) {
        zhCounts.set(word, (zhCounts.get(word) ?? 0) + count);
      }
    } else {
      process.stdout.write(`[dict] skip ko: ${ko.skippedReason}\n`);
    }
  }

  if (jmdict && !jmdict.skippedReason) {
    const merge = await mergeJmdictIntoWordsJa();
    if (merge.skippedReason) {
      process.stdout.write(`[dict] skip merge JMdict -> words_ja: ${merge.skippedReason}\n`);
    } else {
      process.stdout.write(`[dict] merged JMdict into words_ja: ${merge.merged}\n`);
      counts.jmdict_ja = jmdict.wordCount;
    }
  } else if (jmdict?.skippedReason) {
    process.stdout.write(`[dict] skip JMdict: ${jmdict.skippedReason}\n`);
  }

  const zhCount = await writeWordsZh({ zhCounts });
  counts.words_zh = zhCount;
  process.stdout.write(`[dict] wrote ${zhCount} words_zh\n`);

  const compressed = await compressProcessed({ copyToPublic: true });
  const manifestPath = await writeManifest({ outDir: finalDir, files: compressed.files, counts });

  const publicManifestPath = path.join(extensionPublicDataDir, "manifest.json");
  await copyFileStream(manifestPath, publicManifestPath);

  process.stdout.write(`[dict] wrote manifest: ${manifestPath}\n`);
  process.stdout.write(`[dict] copied manifest -> ${publicManifestPath}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

import path from "node:path";
import { createWriteStream, existsSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensureDir, fileSizeBytes } from "./fs";
import { withConcurrencyLimit } from "./concurrency";
import { parseArgs, getNumberArg, getBooleanArg } from "./args";
import { rawDir } from "./paths";

type DownloadTarget = { name: string; url: string; outFile: string };

async function downloadFile(target: DownloadTarget): Promise<void> {
  if (existsSync(target.outFile)) {
    const size = await fileSizeBytes(target.outFile);
    process.stdout.write(`[dict] skip (exists) ${target.name} (${size} bytes)\n`);
    return;
  }

  process.stdout.write(`[dict] download ${target.name}\n  ${target.url}\n`);
  await ensureDir(path.dirname(target.outFile));

  const response = await fetch(target.url);
  if (!response.ok) {
    throw new Error(`[dict] download failed ${target.name}: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error(`[dict] download failed ${target.name}: empty response body`);
  }

  // Stream to file so the process doesn't exit before large downloads flush.
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(target.outFile));

  const size = await fileSizeBytes(target.outFile);
  process.stdout.write(`[dict] downloaded ${target.name} (${size} bytes)\n`);
}

export async function downloadAll(options: {
  concurrency: number;
  includeKaikki: boolean;
  includeJmdict: boolean;
}): Promise<void> {
  await ensureDir(rawDir);
  const targets: DownloadTarget[] = [
    {
      name: "ECDICT (ecdict.csv)",
      url: "https://github.com/skywind3000/ECDICT/raw/master/ecdict.csv",
      outFile: path.join(rawDir, "ecdict.csv"),
    },
  ];

  if (options.includeJmdict) {
    targets.push({
      name: "JMdict (JMdict_e.gz)",
      url: "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz",
      outFile: path.join(rawDir, "JMdict_e.gz"),
    });
  }

  if (options.includeKaikki) {
    targets.push(
      {
        name: "Kaikki JA (ja-extract.jsonl.gz)",
        url: "https://kaikki.org/dictionary/downloads/ja/ja-extract.jsonl.gz",
        outFile: path.join(rawDir, "ja-extract.jsonl.gz"),
      },
      {
        name: "Kaikki KO (ko-extract.jsonl.gz)",
        url: "https://kaikki.org/dictionary/downloads/ko/ko-extract.jsonl.gz",
        outFile: path.join(rawDir, "ko-extract.jsonl.gz"),
      },
    );
  }

  await withConcurrencyLimit(
    targets.map((t) => () => downloadFile(t)),
    options.concurrency,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const concurrency = getNumberArg(args, "concurrency") ?? 3;
  const includeKaikki = !getBooleanArg(args, "no-kaikki");
  const includeJmdict = !getBooleanArg(args, "no-jmdict");
  await downloadAll({ concurrency, includeKaikki, includeJmdict });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

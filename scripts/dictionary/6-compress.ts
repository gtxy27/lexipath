import path from "node:path";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { createGzip } from "node:zlib";
import { finalDir, processedDir, extensionPublicDataDir } from "./paths";
import { ensureDir, sha256File, listFiles, copyFileStream } from "./fs";
import { parseArgs, getBooleanArg } from "./args";

async function gzipFile(srcPath: string, outPath: string): Promise<void> {
  await ensureDir(path.dirname(outPath));
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(srcPath);
    const gzip = createGzip({ level: 9 });
    const output = createWriteStream(outPath);
    input.on("error", reject);
    gzip.on("error", reject);
    output.on("error", reject);
    output.on("close", () => resolve());
    input.pipe(gzip).pipe(output);
  });
}

export type CompressResult = {
  files: Array<{ name: string; sha256: string }>;
};

export async function compressProcessed(options: { copyToPublic: boolean }): Promise<CompressResult> {
  await ensureDir(finalDir);
  const processedFiles = (await listFiles(processedDir)).filter((f) => {
    if (!f.endsWith(".json")) return false;
    const base = path.basename(f);
    if (base.startsWith("jmdict_")) return false;
    return true;
  });
  if (processedFiles.length === 0) throw new Error(`[dict] no processed json files found in ${processedDir}`);

  const files: Array<{ name: string; sha256: string }> = [];

  for (const srcPath of processedFiles) {
    const base = path.basename(srcPath);
    const outName = `${base}.gz`;
    const outPath = path.join(finalDir, outName);
    process.stdout.write(`[dict] gzip ${base} -> ${outName}\n`);
    await gzipFile(srcPath, outPath);
    const sha256 = await sha256File(outPath);
    files.push({ name: outName, sha256 });
  }

  if (options.copyToPublic) {
    await ensureDir(extensionPublicDataDir);
    for (const { name } of files) {
      const src = path.join(finalDir, name);
      const dest = path.join(extensionPublicDataDir, name);
      await copyFileStream(src, dest);
    }
  }

  return { files };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const copyToPublic = !getBooleanArg(args, "no-public-copy");
  if (!existsSync(processedDir)) {
    throw new Error(`[dict] missing ${processedDir} (run dict:build first)`);
  }
  await compressProcessed({ copyToPublic });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

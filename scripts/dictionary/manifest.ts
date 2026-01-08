import path from "node:path";
import { writeFile } from "node:fs/promises";
import { ensureDir } from "./fs";

export type DictionaryBuildManifest = {
  version: 1;
  buildAt: string;
  files: Record<string, { sha256: string }>;
  counts: Record<string, number>;
};

export async function writeManifest(options: {
  outDir: string;
  files: Array<{ name: string; sha256: string }>;
  counts: Record<string, number>;
}): Promise<string> {
  await ensureDir(options.outDir);
  const manifest: DictionaryBuildManifest = {
    version: 1,
    buildAt: new Date().toISOString(),
    files: Object.fromEntries(options.files.map((f) => [f.name, { sha256: f.sha256 }])),
    counts: options.counts,
  };

  const outPath = path.join(options.outDir, "manifest.json");
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return outPath;
}


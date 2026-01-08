import path from "node:path";
import { processedDir } from "./paths";
import { ensureDir } from "./fs";
import { createJsonArrayFileWriter } from "./json";

export async function writeWordsZh(options: { zhCounts: Map<string, number> }): Promise<number> {
  await ensureDir(processedDir);
  const outPath = path.join(processedDir, "words_zh.json");
  const { writer, close } = await createJsonArrayFileWriter(outPath);

  const entries = [...options.zhCounts.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  );
  for (const [word, count] of entries) {
    writer.write({ word, frequency: count });
  }

  return close();
}


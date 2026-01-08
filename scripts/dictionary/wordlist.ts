import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export async function loadWordlist(filePath: string): Promise<Set<string>> {
  if (!existsSync(filePath)) return new Set();
  const raw = await readFile(filePath, "utf8");
  const set = new Set<string>();
  for (const line of raw.split(/\r?\n/g)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    set.add(trimmed);
  }
  return set;
}


import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function listFiles(dirPath: string): Promise<string[]> {
  if (!existsSync(dirPath)) return [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => path.join(dirPath, e.name))
    .sort((a, b) => a.localeCompare(b));
}

export async function safeRm(targetPath: string): Promise<void> {
  if (!existsSync(targetPath)) return;
  await rm(targetPath, { recursive: true, force: true });
}

export async function fileSizeBytes(filePath: string): Promise<number> {
  const info = await stat(filePath);
  return info.size;
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function copyFileStream(srcPath: string, destPath: string): Promise<void> {
  await ensureDir(path.dirname(destPath));
  await new Promise<void>((resolve, reject) => {
    const input = createReadStream(srcPath);
    const output = createWriteStream(destPath);
    input.on("error", reject);
    output.on("error", reject);
    output.on("close", () => resolve());
    input.pipe(output);
  });
}


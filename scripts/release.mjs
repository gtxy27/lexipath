import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    skipBuild: args.has("--skip-build"),
    noSha256: args.has("--no-sha256"),
  };
}

function run(command, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${command} ${args.join(" ")}`));
    });
  });
}

async function readManifestVersion(manifestPath) {
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  if (!manifest?.version) throw new Error(`Missing version in manifest: ${manifestPath}`);
  return String(manifest.version);
}

async function writeSha256(filePath) {
  const bytes = await readFile(filePath);
  const hash = crypto.createHash("sha256").update(bytes).digest("hex");
  const line = `${hash}  ${path.basename(filePath)}\n`;
  await writeFile(`${filePath}.sha256`, line, "utf8");
}

async function zipDir({ srcDir, outFile }) {
  await mkdir(path.dirname(outFile), { recursive: true });
  if (!existsSync(srcDir)) throw new Error(`Missing directory: ${srcDir}`);

  const entries = (await readdir(srcDir)).sort((a, b) => a.localeCompare(b));
  if (entries.length === 0) throw new Error(`Nothing to package (empty dir): ${srcDir}`);

  await run("tar", ["-c", "--format=zip", "-f", outFile, "-C", srcDir, ...entries], {
    cwd: repoRoot,
  });
}

async function main() {
  const { skipBuild, noSha256 } = parseArgs(process.argv.slice(2));

  if (!skipBuild) {
    await run("bun", ["run", "build"], { cwd: repoRoot });
  }

  const chromeDir = path.join(repoRoot, "apps", "extension", "dist", "chrome");
  const firefoxDir = path.join(repoRoot, "apps", "extension", "dist", "firefox");
  const outDir = path.join(repoRoot, "dist");

  const chromeManifest = path.join(chromeDir, "manifest.json");
  const firefoxManifest = path.join(firefoxDir, "manifest.json");
  if (!existsSync(chromeManifest)) throw new Error(`Missing build output: ${chromeManifest}`);
  if (!existsSync(firefoxManifest)) throw new Error(`Missing build output: ${firefoxManifest}`);

  const chromeVersion = await readManifestVersion(chromeManifest);
  const firefoxVersion = await readManifestVersion(firefoxManifest);
  if (chromeVersion !== firefoxVersion) {
    throw new Error(
      `Version mismatch: chrome=${chromeVersion}, firefox=${firefoxVersion}. Rebuild and try again.`,
    );
  }

  const version = chromeVersion;
  const chromeZip = path.join(outDir, `lexipath-chrome-${version}.zip`);
  const firefoxXpi = path.join(outDir, `lexipath-firefox-${version}.xpi`);

  await zipDir({ srcDir: chromeDir, outFile: chromeZip });
  await zipDir({ srcDir: firefoxDir, outFile: firefoxXpi });

  if (!noSha256) {
    await writeSha256(chromeZip);
    await writeSha256(firefoxXpi);
  }

  process.stdout.write(`Wrote: ${chromeZip}\n`);
  process.stdout.write(`Wrote: ${firefoxXpi}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

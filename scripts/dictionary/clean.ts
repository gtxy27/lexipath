import { safeRm } from "./fs";
import { processedDir, rawDir } from "./paths";

async function main(): Promise<void> {
  await safeRm(rawDir);
  await safeRm(processedDir);
  process.stdout.write(`[dict] cleaned ${rawDir} and ${processedDir}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});


import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const lexipathRoot = path.resolve(__dirname, "../..");

export const dataRoot = path.join(lexipathRoot, "data");
export const rawDir = path.join(dataRoot, "raw");
export const processedDir = path.join(dataRoot, "processed");
export const finalDir = path.join(dataRoot, "final");
export const wordlistsDir = path.join(dataRoot, "wordlists");

export const extensionPublicDataDir = path.join(
  lexipathRoot,
  "apps",
  "extension",
  "public",
  "data",
);


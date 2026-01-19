import { dictionaryService } from './services/dictionary';

type DictionaryBuildManifest = {
  version: 1;
  buildAt: string;
  files: Record<string, { sha256: string }>;
  counts: Record<string, number>;
};


const SEEDED_SIGNATURE_KEY = 'dictionary.seed.signature.v1';
const SEEDED_VERSION_KEY = 'dictionary.seed.version.v1';

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[dict-seed] Failed to parse ${label}: ${message}`);
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[dict-seed] Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchGzipJsonArray(url: string): Promise<unknown[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[dict-seed] Failed to fetch ${url}: ${res.status} ${res.statusText}`);

  // Browser-compatible gzip decode.
  // Note: Chrome/Firefox extension contexts support DecompressionStream('gzip').
  const ds = new DecompressionStream('gzip');
  const decompressed = res.body!.pipeThrough(ds);
  const json = await new Response(decompressed).text();

  const parsed = parseJson<unknown>(json, url);
  if (!Array.isArray(parsed)) throw new Error(`[dict-seed] Expected JSON array in ${url}`);
  return parsed;
}


function manifestSignature(manifest: DictionaryBuildManifest): string {
  // Manifest already contains per-file sha256 (of the gz files). A stable signature is just
  // sorted name->sha256 pairs + version.
  const entries = Object.entries(manifest.files)
    .map(([name, meta]) => `${name}:${meta.sha256}`)
    .sort((a, b) => a.localeCompare(b));
  return `v${manifest.version}|${entries.join('|')}`;
}

async function* iterateArray(items: unknown[]): AsyncGenerator<unknown> {
  for (const item of items) yield item;
}

export async function seedDictionaryFromPublicData(options: { force?: boolean } = {}): Promise<{ seeded: boolean }> {
  // Ensure DB is ready.
  await dictionaryService.init();

  const manifestUrl = '/data/manifest.json';
  const manifestRaw = await fetchText(manifestUrl);
  const manifest = parseJson<DictionaryBuildManifest>(manifestRaw, manifestUrl);

  const signature = manifestSignature(manifest);
  const prevSignature = await dictionaryService.getMeta(SEEDED_SIGNATURE_KEY);
  const prevVersion = await dictionaryService.getMeta(SEEDED_VERSION_KEY);

  if (!options.force && prevSignature === signature && prevVersion === String(manifest.version)) {
    return { seeded: false };
  }

  // Clear only seeded offline stores; keep lookup_cache.
  const storesToClear = [
    // Keep meta; we will overwrite our own keys after successful import.
    'words_en',
    'words_zh',
    'words_ja',
    'words_ko',
    'en_zh',
    'ja_zh',
    'ko_zh',
    'en_ja',
    'en_ko',
  ];

  await dictionaryService.clearStores(storesToClear);

  // Import files listed in manifest. We only import known store files.
  const supported = new Set([
    'words_en.json.gz',
    'words_zh.json.gz',
    'words_ja.json.gz',
    'words_ko.json.gz',
    'en_zh.json.gz',
    'ja_zh.json.gz',
    'ko_zh.json.gz',
    'en_ja.json.gz',
    'en_ko.json.gz',
  ]);

  for (const name of Object.keys(manifest.files)) {
    if (!supported.has(name)) continue;

    const storeName = name.replace(/\.json\.gz$/, '');
    const url = `/data/${name}`;
    const rows = await fetchGzipJsonArray(url);

    // Batch import to avoid long-lived transactions.
    await dictionaryService.importRecords(storeName, iterateArray(rows), { batchSize: 2000 });
  }

  // Persist signature so future boots can skip reseeding.
  await dictionaryService.setMeta(SEEDED_SIGNATURE_KEY, signature);
  await dictionaryService.setMeta(SEEDED_VERSION_KEY, String(manifest.version));

  return { seeded: true };
}

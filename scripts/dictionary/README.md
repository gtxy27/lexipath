# Dictionary build scripts (local)

These scripts implement the `plan14`-style dictionary data pipeline and are meant to run **locally**.

## Prerequisites

- `bun` (recommended, already used by this repo)

## Outputs

- Intermediate files: `lexipath/data/processed/` (gitignored)
- Final artifacts (JSON + gzip): `lexipath/data/final/`
- Public copy for extension bundling: `lexipath/apps/extension/public/data/`

Artifacts include:

- `words_en.json.gz`
- `words_ja.json.gz` (if Kaikki JA input + wordlist available)
- `words_ko.json.gz` (if Kaikki KO input + wordlist available)
- `words_zh.json.gz`
- `en_zh.json.gz`, `ja_zh.json.gz`, `ko_zh.json.gz`
- `manifest.json` (counts + hashes)

## Quick start

1) Edit wordlists (optional but strongly recommended to keep Kaikki inputs bounded):

- `lexipath/data/wordlists/jlpt-n5-n3.txt`
- `lexipath/data/wordlists/topik-1-2.txt`

2) Run:

```bash
bun run dict:build
```

## Notes

- Kaikki extracts can be very large. These scripts default to **wordlist filtering** for JA/KO.
- If you want to build without wordlists, pass `--no-wordlist` (not recommended; expect long runtimes and large outputs).
- JMdict is used to enrich Japanese entries (e.g. `reading`) and is **only parsed with a wordlist**.

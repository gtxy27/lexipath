# LexiPath

[简体中文](README.md) | English

Immersive language learning browser extension - transform web pages and video subtitles with intelligent **i+1** enhancement.

[![GitHub stars](https://img.shields.io/github/stars/gtxy27/lexipath?style=social)](https://github.com/gtxy27/lexipath/stargazers)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=gtxy27/lexipath&type=Date)](https://star-history.com/#gtxy27/lexipath&Date)

## Features

- **Web Enhancement**: Transform web pages with target language input (i+1)
- **Video Subtitles**: YouTube + Bilibili subtitle enhancement with single/bilingual modes
- **Subtitle Keywords**: Highlight key words/phrases and prefetch explanations for the next ~15 seconds
- **Word Learning**: Word cards, familiarity tracking, TTS pronunciation
- **AI-Powered**: OpenAI-compatible providers, user-configurable
- **Cross-Browser**: Chrome/Edge + Firefox support
- **Quality Gating**: Zod validation + fallback rules; prefer not rendering over showing garbage

## Project Structure

```
lexipath/
  apps/extension/                # Browser extension (React + Vite, MV3)
  packages/
    core/                        # Pure TS types, schemas, validators, strategies
    providers/                   # OpenAI-compatible providers + translate adapters
    subtitles/                   # YouTube + Bilibili subtitle adapters (unified Cue model)
    dictionary/                  # IndexedDB dictionary service
    storage/                     # Storage/sync helpers (e.g. WebDAV)
```

## Development

### Prerequisites

- [Bun](https://bun.sh/) (package manager)

### Install dependencies

```bash
bun install
```

### Test / Typecheck

```bash
bun run test
bun run typecheck
```

### Local Dictionary Data Build (plan14)

Build dictionary artifacts as `JSON + gzip` for offline IndexedDB import.

```bash
# Download sources (ECDICT + JMdict + Kaikki)
bun run dict:download

# One-shot build: parse -> merge -> gzip -> copy to apps/extension/public/data
bun run dict:build
```

### Build

```bash
# Build for Chrome
bun run build:chrome

# Build for Firefox
bun run build:firefox

# Build for both
bun run build
```

### Release (zip/xpi)

After building, you can package `apps/extension/dist/*` into distributable archives.

```bash
# Run inside lexipath/ (one command: build + package)
bun run release

# If you've already built (package only)
bun run release:skip-build
```

Artifacts are written to `lexipath/dist/`:
- `lexipath-chrome-<version>.zip`
- `lexipath-firefox-<version>.xpi`
- plus matching `*.sha256`

Notes:
- `release` uses system `tar` to create zip containers (Windows 10+ ships `tar.exe`; macOS ships bsdtar; on Linux install `bsdtar`/`libarchive-tools`).
- Optional flags: `bun scripts/release.mjs --skip-build`, `bun scripts/release.mjs --no-sha256`.

### Development mode (watch build)

```bash
bun run dev
```

## Load extension (local)

**Chrome/Edge:**
1. Go to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `apps/extension/dist/chrome`

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `apps/extension/dist/firefox/manifest.json`

## Configuration

### Providers (OpenAI-compatible)

In the Options page you can configure `baseUrl`, `apiKey`, and `model` for any OpenAI-compatible gateway.

### Advanced: per-model concurrency limits

You can configure how many AI requests run in parallel per model (keyed by `baseUrl|model`).

```json
{
  "https://api.openai.com/v1|gpt-4o-mini": 20
}
```

## Docs

- Extension app: `apps/extension/src`
- Provider adapters: `packages/providers/src`
- Subtitle adapters: `packages/subtitles/src`

## License

MIT

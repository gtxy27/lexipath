# LexiPath

Immersive language learning browser extension - transform web pages and videos with intelligent i+1 enhancement.

## Features

- **Web Enhancement**: Transform web pages with target language input (i+1)
- **Video Subtitles**: YouTube + Bilibili subtitle enhancement with single/bilingual modes
- **Subtitle Keywords**: Highlight key words/phrases and prefetch explanations for the next ~15 seconds
- **Word Learning**: Word cards, familiarity tracking, TTS pronunciation
- **AI-Powered**: OpenAI-compatible providers, user-configurable
- **Cross-Browser**: Chrome/Edge + Firefox support

## Project Structure

```
lexipath/
├── apps/extension/         # Browser extension (React + Vite)
├── packages/
│   ├── core/              # Pure TS types, schemas, validators
│   ├── providers/         # OpenAI-compatible adapter
│   ├── subtitles/         # YouTube + Bilibili adapters
│   └── dictionary/        # IndexedDB dictionary service
└── docs/                  # Documentation
```

## Development

### Prerequisites

- [Bun](https://bun.sh/) (package manager)

### Install dependencies

```bash
bun install
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

### Development mode

```bash
bun run dev
```

### Load extension

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

### Advanced: Per-model concurrency limits

In the Options page, you can configure how many AI requests run in parallel per model (keyed by `baseUrl|model`).

Example:

```json
{
  "https://api.openai.com/v1|gpt-4o-mini": 20
}
```

## License

MIT

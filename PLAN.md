# LexiPath - Development Plan

LexiPath is a TypeScript rewrite of the Ries browser extension, combining the best of Ries and VocabMeld to create an open-source immersive language learning tool.

---

## 1. Project Overview

### 1.1 Goals

- **Open Source**: No dependency on commercial services; users configure their own OpenAI-compatible providers
- **TypeScript Rewrite**: Interface-driven, unidirectional dependency monorepo architecture
- **Cross-Browser**: Chrome/Edge + Firefox with equal support from day one
- **Default High Difficulty**: i+1 strategy, target language first, native language on-demand
- **Quality Gating**: Zod validation + fallback rules; prefer not rendering over showing garbage

### 1.2 Core Features

| Feature | Description |
|---------|-------------|
| Web Enhancement | Transform web pages with target language input (i+1), toggle back to original |
| Video Subtitles | YouTube + Bilibili subtitle enhancement, single/bilingual modes |
| Word Learning | Word cards, familiarity tracking, TTS pronunciation |
| Smart Explanation | AI-powered word/phrase explanations |
| Sidebar Chat | Multi-turn conversations for deeper understanding |

### 1.3 Reference Projects

- **Ries (src-extension/)**: Legacy extension rebuilt for readability; provides behavior baseline
- **VocabMeld**: Open-source vocab learning extension; reference for CEFR filtering, LRU caching, DOM replacement

---

## 2. Technical Stack (Fixed)

| Layer | Technology |
|-------|------------|
| Package Manager / Runtime | **Bun** |
| Bundler | **Vite** (multi-entry: background/content/ui) |
| UI Framework | **React + Tailwind** |
| Runtime Validation | **Zod** |
| Testing | **Vitest** |
| Extension Standard | **MV3** (Manifest Version 3) |

### 2.1 TypeScript Configuration

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "useUnknownInCatchVariables": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### 2.2 Browser Support

- Chrome/Edge (Chromium-based)
- Firefox
- Both must be supported simultaneously; no "Chrome first, Firefox later" approach

---

## 3. Repository Structure

```
lexipath/
├── apps/
│   └── extension/
│       ├── background/     # MV3 service worker
│       ├── content/        # Content script + overlay
│       └── ui/             # React pages
│           ├── popup/      # Quick controls
│           ├── options/    # Settings, provider config
│           ├── onboarding/ # Setup wizard
│           └── sidebar/    # Chat interface
│
├── packages/
│   ├── core/               # Pure TS, no browser APIs
│   │   ├── qualify/        # Site/content gating
│   │   ├── strategy/       # tier + masterWords (i+1)
│   │   ├── validators/     # Output schemas + validation
│   │   └── cache-key/      # Cache key generation
│   │
│   ├── providers/          # OpenAI-compatible adapter
│   ├── subtitles/          # YouTube + Bilibili adapters
│   └── dictionary/         # IndexedDB + offline dict
│
├── docs/                   # Documentation
├── scripts/                # Build & utility scripts
└── dist/                   # Build output (gitignored)
```

### 3.1 Dependency Direction (Must Follow)

```
apps/extension ──depends on──> packages/*
packages/providers ──depends on──> packages/core (types only)
packages/subtitles ──depends on──> packages/core (types only)
packages/dictionary ──depends on──> packages/core (types only)
packages/core ──depends on──> nothing (pure TS only)
```

**Rules:**
- `packages/core`: No browser APIs, DOM, or network implementation
- `packages/providers`: Allowed `fetch`/network, but not `apps/extension`
- `apps/extension`: Can use `browser.*`, DOM, and UI frameworks

---

## 4. Workstreams & Milestones

### Phase 1: Foundation (Current)

| # | Workstream | Description | DoD |
|---|------------|-------------|-----|
| 1.1 | Project Skeleton | Bun monorepo, TS config, Vite setup | `bun install` + `bun run build` works |
| 1.2 | Manifest & Entry | manifest.json (Chrome/Firefox), empty entry files | Extension loads in both browsers |
| 1.3 | i18n Setup | Messages structure, zh-CN + en | i18n keys usable in code |
| 1.4 | Core Types | Base schemas (Settings, Messages, Cue, etc.) | Types exported from `@lexipath/core` |

### Phase 2: Messaging & Provider

| # | Workstream | Description | DoD |
|---|------------|-------------|-----|
| 2.1 | Message Protocol | `runtime.sendMessage` infrastructure with Zod | Messages flow between content/popup/background |
| 2.2 | Provider Adapter | OpenAI-compatible request/response | "Test connection" works in Options |
| 2.3 | Settings Storage | `storage.local` read/write with validation | Settings persist across sessions |

### Phase 3: Web Enhancement MVP

| # | Workstream | Description | DoD |
|---|------------|-------------|-----|
| 3.1 | Qualify Logic | Site gating + content gating + language detection | Correct channel determination |
| 3.2 | Strategy | tier + masterWords calculation | Strategy output for enhancement |
| 3.3 | Validators | Web enhancement output schema + fallback | Invalid outputs rejected |
| 3.4 | Content Rendering | Overlay (Shadow DOM) + toggle original | 1 web page scenario works |

### Phase 4: Word Learning

| # | Workstream | Description | DoD |
|---|------------|-------------|-----|
| 4.1 | Dictionary | IndexedDB structure + query interface | Word lookup works offline |
| 4.2 | Word Card UI | Hover/click word card with definition, phonetic | Cards render correctly |
| 4.3 | TTS | Browser TTS integration | Pronunciation plays |
| 4.4 | Familiarity | Local familiarity tracking | Familiarity updates on events |

### Phase 5: Subtitles

| # | Workstream | Description | DoD |
|---|------------|-------------|-----|
| 5.1 | YouTube Adapter | Subtitle fetch + cue normalization | Cues extracted from YouTube |
| 5.2 | Bilibili Adapter | Subtitle fetch + cue normalization | Cues extracted from Bilibili |
| 5.3 | Subtitle Rendering | Single/bilingual modes, hold-for-bilingual | Subtitles display correctly |

### Phase 6: Explanation & Chat

| # | Workstream | Description | DoD |
|---|------------|-------------|-----|
| 6.1 | Explain Word | AI explanation with caching | Word explanations show |
| 6.2 | Sidebar Chat | Multi-turn conversation UI | Chat works with history |
| 6.3 | Session Management | Continuation ID, truncation, expiry | Long chats don't break |

### Phase 7: Polish

| # | Workstream | Description | DoD |
|---|------------|-------------|-----|
| 7.1 | Onboarding | Level selection, mode matrix wizard | New users can configure |
| 7.2 | Popup | Quick controls, site status | Popup is functional |
| 7.3 | Options | Full settings UI | All settings configurable |
| 7.4 | Cross-Browser QA | Full manual test suite | Chrome + Firefox verified |

---

## 5. Message Protocol

### 5.1 Message Types

```typescript
// Message type constants (SCREAMING_SNAKE_CASE)
type MessageType =
  | 'GET_SETTINGS'
  | 'SET_SETTINGS'
  | 'REQUEST_HOST_PERMISSION'
  | 'ENHANCE_WEB'
  | 'ENHANCE_SUBTITLE'
  | 'EXPLAIN_WORD'
  | 'CHAT';

// Base message structure
interface Message<T extends MessageType, P = unknown> {
  type: T;
  payload: P;
}

// Response structure
interface Response<T> {
  ok: true;
  value: T;
} | {
  ok: false;
  error: {
    code: string;
    message: string;
  };
};
```

### 5.2 Validation Rules

- All payloads validated with Zod on both sender and receiver
- Failures must return structured errors (never swallowed)
- Model outputs treated as untrusted input

---

## 6. Output Schemas & Quality Gating

### 6.1 Web Enhancement Schema

```typescript
const WebEnhanceOutputSchema = z.object({
  content_result: z.string(),
  convert_word: z.array(z.object({
    original: z.string(),
    converted: z.string(),
    difficulty: z.string().optional(),
  })).optional(),
});
```

### 6.2 Subtitle Enhancement Schema

```typescript
const SubtitleEnhanceOutputSchema = z.object({
  line1_final: z.string(),
  line2_final: z.string().optional(),
  line3_final: z.string().optional(),
});
```

### 6.3 Fallback Rules

| Condition | Action |
|-----------|--------|
| Schema validation fails | Don't render |
| Language constraint fails | Don't render |
| Length inflation > threshold | Don't render |
| Any failure | Return original / hide enhancement / degrade mode |

---

## 7. Subtitle Support

### 7.1 Cue Model

```typescript
interface Cue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  lang: string;
  source: 'youtube' | 'bilibili' | 'netflix' | 'generic';
}
```

### 7.2 UI Behavior

| Mode | Description |
|------|-------------|
| Default | Target language enhanced subtitle only (single line) |
| Toggle | Click to switch to bilingual (enhanced + original) |
| Hold | Hold key for temporary bilingual, release to restore |

### 7.3 Platform Priority

1. **First Release**: YouTube + Bilibili
2. **Future**: Netflix + Generic providers

---

## 8. i18n Strategy

### 8.1 Supported Languages (First Release)

- `zh-CN` (Simplified Chinese) - Primary
- `en` (English)

### 8.2 Implementation

- All UI text via i18n keys
- No hardcoded strings in code
- Chrome/Firefox compatible `_locales` structure

```
_locales/
├── en/
│   └── messages.json
└── zh_CN/
    └── messages.json
```

---

## 9. Performance Requirements (Must Follow)

### 9.1 Content Script

- No high-frequency full-page scans; use `MutationObserver` + targeted filtering + batching
- Batch DOM operations to avoid reflow/repaint storms
- Visible area first (`IntersectionObserver` / virtualization)
- Cache computation-heavy tasks (tokenization, language detection)

### 9.2 Background / Service Worker

- Assume "may be reclaimed anytime"; state must be recoverable from `storage.*`
- Network requests must support timeout + cancellation (`AbortController`)
- In-flight request deduplication

### 9.3 UI Pages

- Use React only where complex interaction needed
- Control bundle size; prefer native Web APIs

### 9.4 Validation

- Parse + validate only once per data item
- Validate external input before use

---

## 10. Code Style & Naming

### 10.1 General

- Indent: 2 spaces
- Line endings: LF
- Language: TypeScript only in `apps/` and `packages/`

### 10.2 Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables/Functions | `camelCase` | `getUserSettings` |
| Classes/Components | `PascalCase` | `WordCard` |
| Constants/Message Types | `SCREAMING_SNAKE_CASE` | `ENHANCE_WEB` |
| File names | `kebab-case.ts` | `word-card.tsx` |

### 10.3 TypeScript

- `any` forbidden (except isolated layers with comments)
- `unknown` preferred for external input
- Public APIs must have explicit types + corresponding Zod schemas

---

## 11. Git Workflow

### 11.1 Branches

- Default: `main`
- Feature branches: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`, `refactor/<topic>`

### 11.2 Commit Messages (Conventional Commits)

```
<type>(<scope>): <subject>

Types: feat, fix, docs, refactor, chore, test, build
```

Examples:
- `feat(core): add zod schema for enhance web`
- `fix(extension): handle optional host permission denial`
- `docs: update development plan`

### 11.3 Forbidden in Commits

- Real API keys, tokens, personal info
- Large dictionary/resource files

---

## 12. Cross-Browser Manifest Strategy

### 12.1 Build Output

```
dist/
├── chrome/
│   ├── manifest.json
│   └── ...
└── firefox/
    ├── manifest.json
    └── ...
```

### 12.2 Differences to Handle

- MV3 service worker lifecycle differences
- `permissions` vs `host_permissions` field behavior
- Optional host permissions flow

---

## 13. Permission Strategy

### 13.1 User Configuration

Users configure in Options:
- `baseUrl` (OpenAI-compatible endpoint)
- `model` (string, not validated)
- `apiKey` (optional)
- Custom headers (optional)

### 13.2 Host Permission Flow

1. User enters `baseUrl` in Options
2. On "Save/Test Connection", request host permission for that origin
3. Success → allow background to fetch
4. Failure → config saved but provider marked unavailable

**Rules:**
- Never request broad `*://*/*` permissions
- Explain to user why permission is needed

---

## 14. Manual Test Checklist

### 14.1 Per-Milestone Tests

- [ ] Popup opens and toggles work
- [ ] Optional host permissions flow
- [ ] Web enhancement: gate → request → validate → render/fallback → toggle original
- [ ] Word card: lookup, TTS, favorite, explain
- [ ] Sidebar chat: multi-turn, truncation, expiry cleanup
- [ ] Subtitles: YouTube + Bilibili, single/bilingual toggle, hold-for-bilingual
- [ ] Background: service worker restart robustness

### 14.2 Cross-Browser

Every milestone must pass on:
- Chrome (latest stable)
- Firefox (latest stable)

---

## 15. Next Steps

### Immediate (Phase 1.1)

1. Initialize Bun monorepo with workspace configuration
2. Set up TypeScript with strict configuration
3. Configure Vite for multi-entry build
4. Create basic manifest.json for both browsers
5. Set up i18n message files
6. Create empty entry files (background, content, popup)
7. Verify extension loads in Chrome + Firefox

### After Skeleton Complete

1. Define core types and Zod schemas in `packages/core`
2. Implement message protocol infrastructure
3. Build provider adapter with "Test Connection"
4. Continue per Phase 2-7 order

---

## Appendix: Reference Documents

| Document | Location | Purpose |
|----------|----------|---------|
| Development Guide | `../docs/DEVELOPMENT.md` | TS rewrite specifications |
| Product Plan | `../docs/OPEN_SOURCE_PRODUCT_PLAN.md` | Feature scope & UX decisions |
| Translation Behavior | `../docs/TRANSLATION_BEHAVIOR.md` | Enhancement logic details |
| PM Summary | `../docs/PRODUCT_PM_SUMMARY.md` | Product manager perspective |
| VocabMeld Technical | `../VocabMeld/TECHNICAL.md` | Reference implementation details |

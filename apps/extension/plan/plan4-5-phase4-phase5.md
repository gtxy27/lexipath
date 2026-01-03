# PLAN-4/5 (Phase 4/5 Work Plan): Subtitle Shared Upper-Layer Modules

Purpose:
- Do NOT modify the existing local plan drafts (`plan4.md`, `plan5.md`); they are treated as completed by the author.
- Implement PLAN-4 Phase 4/5: simplify `SubtitleController` by extracting shared upper-layer modules while preserving behavior.

Scope (code):
- `apps/extension/src/content/subtitle-controller.ts`
- New:
  - `apps/extension/src/content/subtitle-video-sync.ts`
  - `apps/extension/src/content/subtitle-enhancer.ts`

Non-goals (this round):
- Any PLAN-5 “DEVELOPMENT.md alignment” items such as message schema refactors, permissions policy, provider test-connection move, chat persistence, abort/cancel fixes, etc.
- Large folder renames/moves across the codebase.

Commit discipline:
- Keep commits small and focused.
- Commit messages in English and follow Conventional Commits: `<type>(<scope>): <subject>`.
- Ensure `bun run typecheck` passes before each commit.

Design:
- Keep `SubtitleController` as the orchestration layer:
  - Provider lifecycle
  - Overlay rendering
  - User interaction (word card, mode toggle)
  - Keyword prefetch pipeline
  - Platform captions watch state (CC / subtitle toggle)
- Extract the reusable “upper layer” mechanics:
  1) `VideoSync`
     - Owns RAF loop and cue index resolution.
     - Uses the existing fast path (current/next cue check) + binary search fallback.
     - Exposes callback `onCueIndexChange(index)` when cue changes.
  2) `SubtitleEnhancer`
     - Owns enhancement queue, concurrency limit, in-flight dedupe, and bilingual on-demand.
     - Receives `sendEnhanceSubtitle(payload)` callback (so it stays testable and decoupled from message plumbing).
     - Exposes:
       - `getEnhanced(cueId)`
       - `ensureBilingual(cue)`
       - `start()` / `stop()` (stop prevents scheduling new work; does not need to cancel in-flight fetches)
       - `setCues(cues, { subtitleLanguage, generationToken })` to reset state when cues change.

Step-by-step:
1) Add `subtitle-video-sync.ts` (no behavior change).
2) Add `subtitle-enhancer.ts` (no behavior change).
3) Refactor `SubtitleController` to delegate to these modules.
4) Run `bun run typecheck`.
5) Manual smoke checks (recommended):
   - YouTube: cue switching, bilingual toggle, hover word card, CC off hides overlay.
   - Bilibili: cue switching, bilingual toggle, subtitle button off hides overlay, multi-P `?p=` still correct.


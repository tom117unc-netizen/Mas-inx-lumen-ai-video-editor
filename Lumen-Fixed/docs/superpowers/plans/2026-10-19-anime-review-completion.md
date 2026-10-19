# Anime Review Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the pre-install anime-review workflow so Lumen can turn imported episodes, commentary and PNGTuber assets into evidence-aware, approval-safe rough-cut proposals with automated regression coverage.

**Architecture:** Keep source discovery and factual authority separate from timeline mutation. Context Bank research narrows where to inspect, verified source observations outrank priors, and all generated timeline changes travel through the existing stale-safe `ReviewProposal`/`AiPatch` approval path. The final pre-install gate runs tests, typecheck, renderer build and Windows packaging on one exact branch head.

**Tech Stack:** TypeScript, Vitest, Electron, React, Context Bank SQLite bridge, GitHub Actions, electron-builder/NSIS.

**Spec:** `docs/superpowers/specs/2026-10-19-pngtuber-mouth-sync-materialization-design.md` plus the existing anime-review editor modules.

## Global Constraints

- Direct source observations outrank web-research priors.
- Research may narrow an episode/window but must never invent a verified timestamp.
- Timeline mutations must be previewed and approved; planning/search tools remain non-mutating.
- Generated PNGTuber mouth clips are image clips on an unlocked video track and are capped at 1,200 clips per proposal.
- AI patches remain atomic, stale-safe and capped at 5,000 edits.
- Locked timeline content must never be modified by an AI proposal.
- The branch is not considered pre-install complete until tests, typecheck, renderer build and Windows packaging all pass on the same exact head.

## Review Focus

- Contradictory web research versus verified episode observations: verified source evidence wins.
- Search misses covering a suggested research window: the covered candidate is suppressed rather than repeatedly rescanned.
- Evidence beats without verified footage: remain explicitly unverified and cannot be presented as proof.
- Large/invalid PNGTuber proposals: fail before live mutation and preserve the project byte-for-byte.
- Approval after any intervening timeline change: stale proposal is rejected atomically.

---

### Task 1: Complete proposal atomicity regression coverage

**Files:**
- Create: `src/editor/anime-review-approval.test.ts`
- Existing implementation: `src/editor/anime-review-approval.ts`, `src/editor/project-patches.ts`

- [ ] Write tests proving multi-clip `addClip` preview has `before: undefined`, approval creates every clip together, and stale fingerprints reject the entire proposal.
- [ ] Run tests and confirm RED only for missing/incorrect behavior.
- [ ] Make the smallest implementation correction if required.
- [ ] Run focused tests and commit.

### Task 2: Add evidence-aware rough-cut planning

**Files:**
- Create: `src/editor/anime-rough-cut.ts`
- Create: `src/editor/anime-rough-cut.test.ts`
- Reuse: `src/editor/anime-scene-search.ts`, `src/editor/anime-review.ts`

- [ ] Define a pure rough-cut decision model that accepts review beats plus scene-search candidates.
- [ ] Require evidence beats to use only `verified-source` candidates for evidence; unverified candidates can only be inspection tasks/illustration.
- [ ] Prefer verified source, then indexed source, then research prior, then metadata for non-evidence illustration.
- [ ] Preserve locked beats and return explicit unresolved reasons instead of guessing.
- [ ] Test contradictory research, no verified evidence, locked beats and deterministic ordering.
- [ ] Commit once focused tests pass.

### Task 3: Expose bounded rough-cut planning to the anime-review agent

**Files:**
- Modify: `src/integrations/tools/anime-review.ts`
- Modify: `src/integrations/tools/anime-review.test.ts`

- [ ] Add a non-mutating `plan_anime_review_rough_cut` tool using explicit beat input and existing source authority semantics.
- [ ] Return selected visuals, unresolved evidence checks and inspection requests; never mutate the project.
- [ ] Add registry/safety tests first, then implementation.
- [ ] Keep destructive Context Bank functions unexposed.
- [ ] Commit after focused tests/typecheck pass.

### Task 4: End-to-end safety regression

**Files:**
- Create: `src/editor/anime-review-workflow.test.ts`

- [ ] Build a synthetic anime-review project with episode assets, narration, verified observations, a contradictory research prior and PNGTuber image assets.
- [ ] Assert source planning chooses verified evidence over research.
- [ ] Assert rough-cut planning never upgrades unverified research to evidence.
- [ ] Assert mouth-sync proposal preview leaves the source project unchanged.
- [ ] Assert approval materializes all generated clips atomically and stale approval fails.
- [ ] Commit after the workflow test passes.

### Task 5: Exact-head pre-install completion gate

**Files:**
- Modify only if verification exposes a defect.

- [ ] Run full `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npm run dist` on Windows CI.
- [ ] Confirm the installer artifact exists on the same exact commit.
- [ ] Review changed files for accidental scope creep and unsafe tool exposure.
- [ ] Only then mark implementation 100% pre-install complete; real-media reliability remains a post-install validation stage.

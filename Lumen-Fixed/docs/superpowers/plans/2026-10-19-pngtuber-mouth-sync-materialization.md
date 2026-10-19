# PNGTuber Mouth-Sync Materialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materialize waveform-driven PNGTuber mouth states into reviewable image clips that commit atomically after approval.

**Architecture:** Extend the existing pure AI patch/approval pipeline with validated clip creation, then build mouth clips by cloning visual properties from an explicit reference sprite. Expose the result through a non-mutating proposal tool that reuses existing waveform planning and stale-project fingerprint approval.

**Tech Stack:** TypeScript, Vitest, Zustand/Immer editor store, existing Lumen AI tool registry.

**Spec:** `docs/superpowers/specs/2026-10-19-pngtuber-mouth-sync-materialization-design.md`

## Global Constraints
- No filename guessing; all asset/clip/track IDs are explicit.
- No live mutation before approval.
- Approval is stale-fingerprint guarded and one undoable history operation.
- Maximum generated mouth intervals: 1200; absolute AI patch maximum remains 5000.
- Reverse and speed-ramped narration remain unsupported.

## Review Focus
- Duplicate generated clip IDs must reject rather than overwrite an existing clip.
- Destination audio or locked tracks must reject before proposal/commit.
- Missing/non-image mouth assets and reference clips must reject.
- Zero-duration narration should produce no generated clips safely.
- Stale proposals must continue to reject after any timeline change.

---

### Task 1: Atomic `addClip` AI edits

**Files:**
- Modify: `src/editor/project-patches.ts`
- Test: existing project patch/approval test suite (add focused tests beside current patch tests)

**Interfaces:**
- Produces: `AiEdit` variant `{ op: 'addClip'; sequenceId: string; clip: Clip }`.

- [ ] Write failing tests proving valid image clip insertion and rejection of duplicate IDs, unknown assets, locked tracks, and audio destination tracks.
- [ ] Run focused tests and verify RED because `addClip` is unsupported.
- [ ] Implement validated `addClip` in `applyAiPatch`, structured-cloning the supplied clip into the selected sequence only after all validation succeeds.
- [ ] Run focused tests and verify GREEN; run typecheck.
- [ ] Commit `feat: add atomic AI clip creation`.

### Task 2: Preview and approval support for created clips

**Files:**
- Modify: `src/editor/anime-review-approval.ts`
- Modify: `src/editor/store.ts`
- Test: approval/store tests

**Interfaces:**
- Consumes: Task 1 `addClip` edit.
- Produces: preview change with `before: undefined`, created clip in `after`; approved proposal commits created clips through `approveAiProposal`.

- [ ] Write failing tests proving an addition previews correctly, commits once, and stale approval is rejected; where store harness supports it, assert undo removes all approved additions in one history operation.
- [ ] Run focused tests and verify RED.
- [ ] Update proposal preview handling and `approveAiProposal` commit handling for `addClip`.
- [ ] Run focused tests and typecheck; verify GREEN.
- [ ] Commit `feat: approve AI clip additions atomically`.

### Task 3: Pure mouth interval materialization

**Files:**
- Modify: `src/editor/anime-pngtuber-sync.ts`
- Modify: `src/editor/anime-pngtuber-sync.test.ts`

**Interfaces:**
- Produces: `materializeMouthIntervals(intervals, referenceClip, destinationTrackId, assets, idFactory): Clip[]` (exact parameter shape may use a typed options object if clearer).

- [ ] Write failing tests proving exact interval timing, open/closed asset choice, destination track assignment, preserved reference visual styling, reset still-image media timing, and empty interval behavior.
- [ ] Run focused test and verify RED.
- [ ] Implement the pure materializer with structured clones of visual properties and deterministic caller-supplied IDs.
- [ ] Run focused tests and typecheck; verify GREEN.
- [ ] Commit `feat: materialize PNGTuber mouth intervals`.

### Task 4: Reviewable mouth-sync proposal tool

**Files:**
- Modify: `src/integrations/tools/anime-review.ts`
- Modify: `src/integrations/tools/anime-review.test.ts`

**Interfaces:**
- Produces AI tool: `propose_pngtuber_mouth_sync`.
- Inputs: `clip_id`, `reference_sprite_clip_id`, `closed_asset_id`, `open_asset_id`, `destination_track_id`, optional threshold/smoothing/hold/offset settings.
- Output: interval/generated clip counts, `proposal`, `mutation_applied:false`, `requires_approval:true`.

- [ ] Add registry and behavior tests first: tool exists; valid invocation emits only `addClip`; live timeline remains unchanged; invalid image/track IDs reject; >1200 intervals reject.
- [ ] Run focused tests and verify RED.
- [ ] Implement validation, reuse cached waveform/`planMouthSync`, call materializer, build `addClip` patch, and preview through `previewAnimeAiPatch`.
- [ ] Run focused tests and typecheck; verify GREEN.
- [ ] Commit `feat: propose PNGTuber mouth sync clips`.

### Task 5: Whole feature verification

**Files:**
- No production changes unless verification reveals a defect.

- [ ] Run `npm test` from `Lumen-Fixed`.
- [ ] Run `npm run typecheck`.
- [ ] Check exact-head GitHub Actions `Anime review feature CI` and require success.
- [ ] Review the branch diff against the design spec for accidental mutation paths, missing validation, and unsafe overwrite behavior.
- [ ] If a defect is found, add a failing regression test before fixing it, rerun full verification, and commit the fix separately.

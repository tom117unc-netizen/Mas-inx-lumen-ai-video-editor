# AI Timeline Construction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add approval-safe structural timeline edits and use them to materialise narration-driven PNGTuber mouth sync as real editable clips.

**Architecture:** Extend the existing validated `AiPatch` format with exact clip add/remove operations, teach proposal previews about structural changes, then build a PNGTuber proposal tool on those primitives. The live editor remains untouched until the existing approved-proposal path verifies the project fingerprint and commits the patch atomically.

**Tech Stack:** TypeScript, Vitest, existing Lumen editor/store and AgentTool infrastructure.

**Spec:** `docs/superpowers/specs/2026-10-19-ai-timeline-construction-design.md`

## Global Constraints

- Keep the existing 5,000-edit `AiPatch` safety cap.
- Do not infer sprite assets from filenames; use explicit asset IDs.
- Do not mutate the live project while planning or previewing.
- Existing stale-proposal fingerprint verification remains mandatory.
- Generated mouth clips must use integer project frames and exactly cover planned mouth intervals.
- Locked tracks must never be structurally edited by an AI patch.
- Full `npm test`, `npm run typecheck`, and exact-head GitHub Actions must pass before completion.

## Review Focus

- Duplicate generated clip IDs: reject rather than overwrite an existing timeline clip.
- Missing/wrong media asset: reject before changing the cloned project.
- Locked or non-video target track: reject structural PNGTuber edits.
- Replacement allow-list containing an unrelated/missing clip: reject rather than infer intent.
- Project changes after preview: approved apply must reject the stale proposal.

---

### Task 1: Structural AI patch operations

**Files:**
- Modify: `Lumen-Fixed/src/editor/project-patches.ts`
- Test: existing/new `Lumen-Fixed/src/editor/project-patches.test.ts`

**Interfaces:**
- Produces: `AiEdit` variants `{ op: 'addClip'; sequenceId: string; clip: Clip }` and `{ op: 'removeClip'; sequenceId: string; clipId: string; expectedStart?: number; expectedAssetId?: string }`.
- Consumes: existing `Project`, `Clip`, sequence tracks/assets, and `applyAiPatch` clone-first semantics.

- [ ] **Step 1: Write failing tests** for adding a complete image clip, removing a clip, duplicate ID rejection, unknown/locked target track rejection, missing asset rejection, and ensuring the original project is unchanged on both success and failure.
- [ ] **Step 2: Run the focused patch tests** and confirm the new structural cases fail because the operations do not exist.
- [ ] **Step 3: Implement the two `AiEdit` variants and validation** in `project-patches.ts`; validate safe integer timing, positive duration, target track identity/kind, asset existence for media clips, duplicate IDs, locks, and optional remove guards before inserting/deleting on the cloned project.
- [ ] **Step 4: Run focused tests and typecheck**; all structural patch tests must pass.
- [ ] **Step 5: Commit** as `feat: add structural AI clip edits`.

### Task 2: Structural proposal previews

**Files:**
- Modify: `Lumen-Fixed/src/editor/anime-review-approval.ts`
- Test: create/modify approval-focused test file under `Lumen-Fixed/src/editor/`

**Interfaces:**
- Consumes: Task 1 `addClip`/`removeClip` edits.
- Produces: review changes whose `before` or `after` may be absent for structural edits while preserving existing proposal fingerprint behavior.

- [ ] **Step 1: Write failing tests** asserting add previews have no `before`, remove previews have no `after`, ordinary edits retain both snapshots, and applying a structural proposal after any fingerprint-changing project edit is rejected.
- [ ] **Step 2: Run the focused approval tests** and confirm structural preview cases fail under the current locate-both-sides assumption.
- [ ] **Step 3: Update review-change typing and `previewAnimeAiPatch`** to snapshot whichever side exists for add/remove and retain current behavior for track/existing-clip edits.
- [ ] **Step 4: Run approval tests plus existing anime PNGTuber tests**; all pass.
- [ ] **Step 5: Commit** as `feat: preview structural AI edits`.

### Task 3: Pure mouth-interval clip materialisation

**Files:**
- Modify: `Lumen-Fixed/src/editor/anime-pngtuber-sync.ts`
- Modify: `Lumen-Fixed/src/editor/anime-pngtuber-sync.test.ts`

**Interfaces:**
- Consumes: `MouthInterval[]`, a reference `Clip`, explicit open/closed asset IDs, target track ID, deterministic ID prefix.
- Produces: `materializeMouthSyncClips(...): Clip[]` with one image clip per interval.

- [ ] **Step 1: Write failing tests** asserting exact start/duration coverage, state-to-asset mapping, deterministic unique IDs, target track assignment, zero in-point/1x forward playback, and preservation of the template's visual layout/effects without mutating the template.
- [ ] **Step 2: Run `anime-pngtuber-sync.test.ts`** and confirm the materialisation tests fail because the function is absent.
- [ ] **Step 3: Implement `materializeMouthSyncClips`** as a pure function using cloned template visual properties and interval timing; reject non-image templates, empty asset IDs, invalid/overlapping/gapped intervals, and unsafe IDs/timing.
- [ ] **Step 4: Run the focused test and typecheck**; all pass.
- [ ] **Step 5: Commit** as `feat: materialize PNGTuber mouth sync clips`.

### Task 4: Approval-safe PNGTuber mouth-sync proposal tool

**Files:**
- Modify: `Lumen-Fixed/src/integrations/tools/anime-review.ts`
- Modify: `Lumen-Fixed/src/integrations/tools/anime-review.test.ts`
- Modify/add focused tool tests as needed.

**Interfaces:**
- Consumes: existing narration waveform planner, Task 3 materialiser, Task 1 structural patch edits, `previewAnimeAiPatch`.
- Produces: AgentTool `propose_pngtuber_mouth_sync` returning `{ interval_count, generated_clip_count, removed_clip_count, proposal, mutation_applied: false, requires_approval: true }`.

- [ ] **Step 1: Add the failing registry/tool tests** requiring `propose_pngtuber_mouth_sync`; test explicit narration/template/target/open/closed IDs, non-mutation, replacement allow-list behavior, locked/non-video track rejection, missing clip/asset rejection, and edit-cap rejection.
- [ ] **Step 2: Run the focused integration tests** and verify RED because the tool is absent.
- [ ] **Step 3: Implement the tool** by sharing/refactoring existing mouth-sync argument validation where useful, computing intervals, materialising image clips, prepending exact `removeClip` edits for `replace_clip_ids`, appending `addClip` edits, and returning `previewAnimeAiPatch` without applying it.
- [ ] **Step 4: Run focused integration/editor tests and typecheck**; all pass.
- [ ] **Step 5: Commit** as `feat: propose materialized PNGTuber mouth sync`.

### Task 5: Regression and branch-head verification

**Files:**
- Modify only if verification reveals a real defect.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: a green exact branch head suitable for the next anime-review assembly subsystem.

- [ ] **Step 1: Run `npm test` in `Lumen-Fixed`**; expected all tests PASS.
- [ ] **Step 2: Run `npm run typecheck`**; expected exit 0.
- [ ] **Step 3: Inspect the branch head** and ensure all planned commits are present in order.
- [ ] **Step 4: Wait for/check the GitHub Actions `Anime review feature CI` run for that exact head SHA**; expected `completed/success`.
- [ ] **Step 5: If CI exposes a defect, reproduce it with a failing test, fix minimally, rerun local verification, commit, and verify the new exact head.**

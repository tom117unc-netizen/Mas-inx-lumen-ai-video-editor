# Contextual Video Construction Implementation Plan

> Execute inline using executing-plans, tests before implementation, then independent branch review.

**Goal:** Connect persistent editorial reasoning to actual frame-precise edits and audiovisual inspection.
**Architecture:** Pure validated construction model; project metadata persistence; registered agent tools; existing atomic timeline operations; improved visual inspection; Copilot protocol.
**Tech Stack:** Existing TypeScript, Zod, Zustand, Immer, Vitest, Electron, React.
**Spec:** ../specs/2026-11-14-contextual-video-construction.md

## Global Constraints
Timeline ranges only. Integer timeline frames. No invented listening or observed facts. No new dependencies. Preserve undo and manual edits. Analysis records are bounded. No new external publishing or changes to the shared base branch.

## Review Focus
- Stale timelines and switching sequence must reject old proposals.
- Silent visual action cannot be deleted using only speech-gap evidence.
- Setup dependencies and protected ranges must survive partial and complete removals.
- Empty/malformed/overlapping/out-of-range proposals must not mutate state.
- Project reload and undo must preserve or invalidate analysis appropriately.

## Tasks
- [x] 1. Add pure construction state, range coverage, hierarchical beats, dependency validation, protected ranges, proposal and review gates. Tests: coverage holes, missing dependencies, cycles, unsafe silence cuts, invalid/stale scope, frame precision, JSON round trip.
- [x] 2. Wire project persistence and tools: begin/get/update construction, validate/apply removals atomically, record post-edit review. Test registered tools, actual timeline changes, one-step undo, stale state, resume and completion.
- [x] 3. Add bounded adjacent-frame and synchronized cut inspection plus event bisection planning. Test exact frames, separate images, budgets, interval/refinement validation and uncertain/repeating events.
- [x] 4. Integrate Copilot construction protocol and truthful bounded-run termination. Run focused tests, full suite, typecheck/build; independent review and fix material findings.

For each task: write tests, observe failure, implement, observe pass, then commit. Record verification and decisions in this plan. Baseline and runtime limitations are reported, not hidden.

## Execution record
- Baseline: 98 files / 510 tests passed on the unmodified upgraded branch.
- Tests were added before the core model, tools and continuation helper. Missing-module failures established absent capabilities; subsequent regression failures reproduced unsafe raw edits, transcript invalidation, image-sequence reload invalidation, read-only continuation authorization, and pause/stale interactions.
- Independent review found three Important issues: beat-tool guard bypass, status queries activating continuation, and image-sequence transport fields affecting fingerprints. All received regression tests and fixes.
- Decision: keep compact plan/receipts in the canonical project so existing save/autosave/recovery carries them. Detailed source analysis remains in the existing Context Bank. Cost: bounded metadata increases project size.
- Decision: preserve bounded cloud runs with progress-checked continuation (up to twelve additional batches), not unlimited execution. Work pauses explicitly when progress stalls or budget is exhausted.
- Decision: audio evidence in this version is transcript plus measured audio; no claim of semantic listening. Real footage quality, mixed-FPS/variable-frame-rate decoding and Windows installer behavior require runtime acceptance, beyond Node unit tests.
- No dependencies added. No changes to the existing shared branch. The separate feature branch is the reviewable delivery.

Final verification: 101 test files, 535 tests passed; TypeScript checking and Vite production build passed. Git diff whitespace checks passed. Windows packaging is delegated to the branch CI; no real stream was edited during this code task.

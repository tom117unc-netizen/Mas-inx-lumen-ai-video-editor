# Context Bank Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first durable Context Bank foundation: project-drive SQLite storage, source fingerprinting, revision-aware timeline mirroring, edit-memory across undo/redo/restarts, and a small budgeted read API for AI tools.

**Architecture:** The `.lumen` document remains authoritative. The renderer produces a compact mirror only after committed editor mutations; a constrained Electron IPC sends it to a main-process Context Bank that reconciles SQLite transactionally and records meaningful edit deltas. Context data lives beside the saved project and is repairable from the project whenever cached state drifts.

**Tech Stack:** Electron 44 / Node 24 `node:sqlite` `DatabaseSync`, TypeScript 7, React 19, Zustand 5, Immer patches, Vitest 5.

**Spec:** `docs/PROJECT_CONTEXT_BANK_DESIGN.md`

## Global Constraints

- Persistent Context Bank files must live under `<project directory>/.lumen-context/<project-id>/`; do not use `userData`/app-data as a fallback for this feature.
- Unsaved projects remain memory-only until a real project path exists.
- The `.lumen` project is always canonical; reconciliation repairs the bank from the project, never the reverse.
- Do not deep-analyse imported episodes in this milestone.
- Do not add a native SQLite dependency; use `node:sqlite` from Electron's bundled Node runtime.
- No raw filesystem API is exposed to the renderer; all persistence stays behind typed preload/IPC methods.
- Store source analysis by source fingerprint rather than timeline position.
- AI reads must be bounded and explicitly report truncation instead of dumping the full bank.
- A failed editor operation must not be recorded as successful.
- Do not claim this milestone complete until typecheck, automated tests, and a real Windows project round-trip on the user's project drive have passed.

## Review Focus

- **Save As across drives:** the new project path receives a copy of the accumulated bank; the old project remains intact.
- **Nested timelines:** `(sequenceId, clipId)` and `(sequenceId, markerId)` are the stable composite identities, so identical IDs in different timelines cannot collide.
- **Undo/redo/crash drift:** after any mismatch, the current `.lumen` state wins and the mirror repairs transactionally without fabricating successful edits.
- **Source replacement:** same path with changed size/content yields a new fingerprint; a mere clip move does not invalidate source analysis.
- **Large timelines:** context queries enforce deterministic item/character budgets and return `truncated: true` rather than unbounded JSON.

---

### Task 1: Stabilize the existing anime tool registry baseline

**Files:**
- Create: `Lumen-Fixed/src/integrations/tools/anime-review.test.ts`
- Modify: `Lumen-Fixed/src/integrations/tools/anime-review.ts`
- Verify: `Lumen-Fixed/src/integrations/agent-tools.ts`

**Interfaces:**
- Consumes: existing `ANIME_REVIEW_TOOLS: AgentTool[]`.
- Produces: a dense array whose every index contains an `AgentTool` with a non-empty unique `name`.

- [ ] **Step 1: Write the failing registry test**

Add tests named `contains no sparse or undefined tool entries` and `uses unique non-empty tool names`. Iterate by numeric index rather than `Array.prototype.every`, because `every` skips sparse holes. Assert the existing three tools are present by name.

- [ ] **Step 2: Run the focused test and confirm the current sparse entry fails**

Run: `cd Lumen-Fixed && npx vitest run src/integrations/tools/anime-review.test.ts`

Expected: FAIL because the current `},,` creates a sparse array entry.

- [ ] **Step 3: Remove the sparse array hole in `anime-review.ts` without changing tool behaviour**

Do not remove the defensive registry filter in `agent-tools.ts`; it remains a last-resort guard, not the primary fix.

- [ ] **Step 4: Run the focused test and typecheck**

Run: `npx vitest run src/integrations/tools/anime-review.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Lumen-Fixed/src/integrations/tools/anime-review.ts Lumen-Fixed/src/integrations/tools/anime-review.test.ts
git commit -m "fix: stabilize anime review tool registry"
```

### Task 2: Define renderer/main Context Bank contracts

**Files:**
- Create: `Lumen-Fixed/shared/context-bank.ts`
- Modify: `Lumen-Fixed/shared/app.ts`
- Modify: `Lumen-Fixed/electron/preload.ts`

**Interfaces:**
- Produces: `ContextBankMirror`, `ContextBankSequenceMirror`, `ContextBankAssetMirror`, `ContextBankMutation`, `ContextBankSyncRequest`, `ContextBankStatus`, `ContextBankQuery`, `ContextBankQueryResult`.
- Produces `AppAPI.contextBank` methods:
  - `sync(request: ContextBankSyncRequest): Promise<ContextBankStatus>`
  - `query(request: ContextBankQuery): Promise<ContextBankQueryResult>`
  - `status(projectPath: string, projectId: string): Promise<ContextBankStatus>`
  - `copyForSaveAs(projectId: string, fromProjectPath: string, toProjectPath: string): Promise<void>`
  - `clear(projectPath: string, projectId: string): Promise<void>`

- [ ] **Step 1: Add compile-time contract fixtures in `shared/context-bank.ts`**

Define versioned discriminants (`format: 'lumen-context-mirror'`, `version: 1`) and exact primitive-only payload fields. A mirror contains project ID/name/revision, file-backed asset metadata, and every sequence's compact clips/markers. A query contains project path/id, optional sequence/range, `purpose`, `maxItems`, and `maxCharacters`.

- [ ] **Step 2: Typecheck before wiring preload**

Run: `npm run typecheck`

Expected: FAIL while `AppAPI.contextBank` is not implemented in preload.

- [ ] **Step 3: Add `APP_IPC` context-bank channels and expose only typed preload methods**

Use channels `lumen:context-bank:sync`, `query`, `status`, `copy-save-as`, and `clear`. Do not expose arbitrary paths or SQL.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Lumen-Fixed/shared/context-bank.ts Lumen-Fixed/shared/app.ts Lumen-Fixed/electron/preload.ts
git commit -m "feat: define context bank IPC contracts"
```

### Task 3: Add project-side SQLite storage and schema v1

**Files:**
- Create: `Lumen-Fixed/electron/context-bank.ts`
- Create: `Lumen-Fixed/electron/context-bank.test.ts`
- Modify: `Lumen-Fixed/electron/app-ipc.ts`

**Interfaces:**
- Produces: `contextBankPath(projectPath: string, projectId: string): string`.
- Produces: `openContextBank(projectPath: string, projectId: string): ContextBankStore`.
- `ContextBankStore` exposes `sync`, `query`, `status`, `clear`, and `close` methods behind the IPC handlers.

- [ ] **Step 1: Write failing storage tests**

Cover: database path is beneath the directory containing the `.lumen` file; invalid/empty project path is rejected rather than falling back to app-data; opening twice is idempotent; schema version is `1`; data written then reopened persists; different project IDs do not share a database.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run electron/context-bank.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement schema v1 with `DatabaseSync`**

Create tables `meta`, `source_assets`, `timeline_clips`, `timeline_markers`, and `edit_events`. Use composite primary keys for sequence-scoped timeline entities, foreign-key-safe deletes where useful, `PRAGMA journal_mode=WAL`, and explicit transactions for reconciliation. Store `schema_version`, `project_id`, `last_revision`, and current project path in metadata.

- [ ] **Step 4: Register trusted IPC handlers**

Validate project ID/path strings, call the store methods, and never accept SQL or arbitrary filesystem operations from the renderer.

- [ ] **Step 5: Run focused tests and node typecheck**

Run: `npx vitest run electron/context-bank.test.ts && npx tsc -p tsconfig.node.json`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Lumen-Fixed/electron/context-bank.ts Lumen-Fixed/electron/context-bank.test.ts Lumen-Fixed/electron/app-ipc.ts
git commit -m "feat: add project-side context bank database"
```

### Task 4: Fingerprint source media without hashing whole episodes

**Files:**
- Create: `Lumen-Fixed/electron/context-bank-fingerprint.ts`
- Create: `Lumen-Fixed/electron/context-bank-fingerprint.test.ts`
- Modify: `Lumen-Fixed/electron/context-bank.ts`

**Interfaces:**
- Produces: `fingerprintSourceFile(file: string): { fingerprint: string; size: number; mtime: number }`.
- Fingerprint input is file size plus at most 1 MiB from the head and 1 MiB from the tail; files at or below 2 MiB may be read in full.

- [ ] **Step 1: Write failing fingerprint tests**

Assert deterministic fingerprints, changed contents produce a changed fingerprint, size participates in identity, and a file larger than 2 MiB is sampled rather than fully read. Assert missing files return a controlled error to the caller rather than crashing database reconciliation.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run electron/context-bank-fingerprint.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement bounded SHA-256 sampling and cache it in `source_assets`**

During sync, reuse an existing fingerprint when normalized path, size, and mtime still match. Recompute when those metadata change. Timeline-only movement must never trigger a re-fingerprint.

- [ ] **Step 4: Run fingerprint and database tests**

Run: `npx vitest run electron/context-bank-fingerprint.test.ts electron/context-bank.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Lumen-Fixed/electron/context-bank-fingerprint.ts Lumen-Fixed/electron/context-bank-fingerprint.test.ts Lumen-Fixed/electron/context-bank.ts
git commit -m "feat: add bounded source fingerprints"
```

### Task 5: Build the compact canonical project mirror

**Files:**
- Create: `Lumen-Fixed/src/editor/context-bank-mirror.ts`
- Create: `Lumen-Fixed/src/editor/context-bank-mirror.test.ts`

**Interfaces:**
- Consumes: `Project`, editor `revision`, and current project path.
- Produces: `createContextBankMirror(project: Project, revision: number): ContextBankMirror`.
- Each clip mirror includes sequence ID, clip ID, track ID, start/duration, asset ID, in-point, speed, and enough source metadata to map timeline frames back to source time.

- [ ] **Step 1: Write failing mirror tests**

Cover the open sequence plus stored nested sequences, clips with and without assets, markers, deterministic ordering, duplicate clip IDs in separate sequences, and omission of runtime URLs/full waveform arrays/transcript bodies.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run src/editor/context-bank-mirror.test.ts`

Expected: FAIL because the mirror builder does not exist.

- [ ] **Step 3: Implement the pure deterministic mirror builder**

Sort assets/sequences/clips/markers by stable IDs (and frames where relevant) so identical project state serializes identically. Include only file path, size, mtime, missing flag and media identity metadata needed by the main process.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run src/editor/context-bank-mirror.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Lumen-Fixed/src/editor/context-bank-mirror.ts Lumen-Fixed/src/editor/context-bank-mirror.test.ts
git commit -m "feat: add compact context bank project mirror"
```

### Task 6: Emit only committed editor mutation events

**Files:**
- Modify: `Lumen-Fixed/src/editor/store.ts`
- Modify: `Lumen-Fixed/src/editor/store.test.ts`

**Interfaces:**
- Produces: `subscribeCommittedEdits(listener: (event: CommittedEditEvent) => void): () => void`.
- `CommittedEditEvent.kind`: `'dispatch' | 'transaction' | 'undo' | 'redo' | 'load'`.
- Event includes current editor revision plus history entry ID/label/source when one exists.

- [ ] **Step 1: Add failing observer tests**

Assert: normal dispatch emits once after success; rejected/no-op operations emit nothing; all inner dispatches of a transaction produce one `transaction` event at `endTransaction`; undo/redo each emit one event; `loadProject` emits `load`; rolled-back transaction work does not appear as a successful event; `history:false` derived mutations do not enter the edit journal in this milestone.

- [ ] **Step 2: Run store tests**

Run: `npx vitest run src/editor/store.test.ts`

Expected: FAIL because the subscription API does not exist.

- [ ] **Step 3: Implement a small listener set at commit boundaries**

Do not infer these events by polling Zustand and do not emit intermediate transaction states. For coalesced history entries, reuse the existing `HistoryEntry.id` so downstream persistence can update one logical edit rather than generate drag spam.

- [ ] **Step 4: Run store tests**

Run: `npx vitest run src/editor/store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Lumen-Fixed/src/editor/store.ts Lumen-Fixed/src/editor/store.test.ts
git commit -m "feat: expose committed editor edit events"
```

### Task 7: Synchronize and reconcile the bank with project/session lifecycle

**Files:**
- Create: `Lumen-Fixed/src/project/context-bank.ts`
- Create: `Lumen-Fixed/src/project/context-bank.test.ts`
- Modify: `Lumen-Fixed/src/project/session.ts`
- Modify: `Lumen-Fixed/src/App.tsx`
- Modify: `Lumen-Fixed/electron/context-bank.ts`
- Modify: `Lumen-Fixed/electron/context-bank.test.ts`

**Interfaces:**
- Produces: `startContextBank(): void`.
- Produces: `syncContextBank(event?: CommittedEditEvent): Promise<void>`.
- Main-process reconciliation consumes a mirror plus optional mutation and returns `ContextBankStatus`.

- [ ] **Step 1: Write failing runtime and reconciliation tests**

Renderer tests: no disk sync while project path is null; saved project schedules sync after committed edits; rapid events sharing a coalesced history ID collapse to one logical pending sync; project load performs reconciliation rather than journaling a user edit.

Main-process tests: add/move/trim/delete produces current rows plus one normalized edit event; undo/redo reconciles current rows correctly; stale rows after a simulated crash are removed on the next full mirror; nested sequence rows remain isolated by sequence ID.

- [ ] **Step 2: Run focused tests**

Run: `npx vitest run src/project/context-bank.test.ts electron/context-bank.test.ts`

Expected: FAIL before runtime wiring exists.

- [ ] **Step 3: Implement debounced mirror sync and transactional reconciliation**

Subscribe to `subscribeCommittedEdits`. Queue mutation metadata and debounce filesystem IPC briefly (target 150 ms) so drag/coalesce updates do not flood SQLite. The final mirror is authoritative. Use mutation/history IDs as idempotency keys for `edit_events`; repeated sync of the same logical edit updates/finalizes that event rather than duplicating it.

- [ ] **Step 4: Wire session open/save lifecycle**

Start the runtime from `App.tsx`. After opening/recovering a project with a path, run a full reconcile. A first-time unsaved project remains memory-only. Do not make Context Bank writes part of the `.lumen` dirty flag.

- [ ] **Step 5: Implement Save As bank copy before switching session path**

When an already-saved project is saved under a new path, call `contextBank.copyForSaveAs(projectId, oldPath, newPath)` after the new `.lumen` file is safely written and before subsequent sync targets the new location. Copy, do not move. If the bank copy fails, keep the project save valid, surface a warning, and let the new bank rebuild its canonical timeline mirror.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `npx vitest run src/project/context-bank.test.ts electron/context-bank.test.ts src/editor/store.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Lumen-Fixed/src/project/context-bank.ts Lumen-Fixed/src/project/context-bank.test.ts Lumen-Fixed/src/project/session.ts Lumen-Fixed/src/App.tsx Lumen-Fixed/electron/context-bank.ts Lumen-Fixed/electron/context-bank.test.ts
git commit -m "feat: keep context bank synced with timeline edits"
```

### Task 8: Add a bounded read API and provider-independent AI tool

**Files:**
- Create: `Lumen-Fixed/src/integrations/tools/context-bank.ts`
- Create: `Lumen-Fixed/src/integrations/tools/context-bank.test.ts`
- Modify: `Lumen-Fixed/src/integrations/agent-tools.ts`
- Modify: `Lumen-Fixed/electron/context-bank.ts`
- Modify: `Lumen-Fixed/electron/context-bank.test.ts`

**Interfaces:**
- `ContextBankQueryResult` returns current matching clips, markers, source identities/fingerprints, and recent relevant edit events plus `revision`, `truncated`, and `warnings`.
- Produces one AI tool: `query_project_context`.
- This milestone does **not** expose cache clearing to AI agents; clear remains an explicit app API until a confirmed UI exists.

- [ ] **Step 1: Write failing query tests**

Assert sequence/range filtering, deterministic ordering, nearby historical edit retrieval, unknown project/range handling, and both `maxItems` and `maxCharacters` truncation. Include a large synthetic timeline proving the result stays bounded and reports `truncated: true`.

- [ ] **Step 2: Write the failing tool test**

Assert `query_project_context` uses the current session project path/id, rejects use before the project is saved, forwards range/purpose/budget, and returns structured data without inventing source content.

- [ ] **Step 3: Run focused tests**

Run: `npx vitest run electron/context-bank.test.ts src/integrations/tools/context-bank.test.ts`

Expected: FAIL because query/tool implementation is incomplete.

- [ ] **Step 4: Implement the bounded SQL query and tool registration**

Register `CONTEXT_BANK_TOOLS` in `agent-tools.ts`. Keep responses compact; do not return complete project JSON, full transcripts, waveform arrays, or unrestricted history. The future analysis/research plan will enrich this result through the same versioned contract.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx vitest run electron/context-bank.test.ts src/integrations/tools/context-bank.test.ts src/integrations/tools/anime-review.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Lumen-Fixed/src/integrations/tools/context-bank.ts Lumen-Fixed/src/integrations/tools/context-bank.test.ts Lumen-Fixed/src/integrations/agent-tools.ts Lumen-Fixed/electron/context-bank.ts Lumen-Fixed/electron/context-bank.test.ts
git commit -m "feat: expose bounded project context queries"
```

### Task 9: Foundation verification and Windows handoff

**Files:**
- Modify only if verification exposes defects; no feature expansion in this task.

**Interfaces:**
- Consumes all Tasks 1-8.
- Produces a verified foundation ready for the separate research/transcript/task-controller implementation plan.

- [ ] **Step 1: Run the complete automated verification**

Run:

```bash
cd Lumen-Fixed
npm run typecheck
npm test
```

Expected: all tests pass. If pre-existing unrelated failures remain, record their exact names/output and do not represent the suite as green.

- [ ] **Step 2: Review the branch diff against the spec**

Confirm there is no app-data fallback, no second editable timeline, no full-episode analysis, no raw renderer filesystem access, and no AI-accessible destructive clear operation.

- [ ] **Step 3: User Windows round-trip when available**

On the user's machine: save a project on `D:`; verify `.lumen-context/<project-id>/context.sqlite` is also on `D:`; add/move/trim/split/delete clips; undo/redo; close/reopen; query context; Save As to another folder/drive; verify both old and new banks; explicitly call/trigger clear only when a UI/manual path exists and confirm the `.lumen` project/media are untouched.

- [ ] **Step 4: Commit verification-only fixes, if any**

Use a focused commit message describing the defect actually fixed. If no defects are found, do not create an empty commit.

## Follow-up plans intentionally excluded

After this foundation is proven, write separate implementation plans for: show/anime identity research and sourced knowledge; reusable ElevenLabs transcription/word timing and source-range observations; guided scene search; resumable long-prompt task orchestration; project-creation UI for show identity + project location; cache inspector/quota/clear UI; and automatic cut/transition QC. These features should build on this bank rather than create parallel memory systems.

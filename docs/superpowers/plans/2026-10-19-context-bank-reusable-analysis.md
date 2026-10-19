# Context Bank Reusable Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist reusable source-time transcripts and source-range observations in the project-side Context Bank so narration can be transcribed once, queried precisely, and reused by any AI provider without re-analysing unchanged media.

**Architecture:** Extend the existing project-local Context Bank from schema v1 to v2. Detailed transcript data is keyed by the source fingerprint already maintained by the main process, stored as an individually gzip-compressed payload, while lightweight range observations remain indexed SQLite rows. Existing `Asset.transcript` phrase timings remain the editable/project-facing caption representation; the Context Bank holds the richer reusable word-level source record and provenance. AI access is through small bounded read/write tools, never direct SQL or an automatic whole-episode scan.

**Tech Stack:** Electron 44 / Node 24 `node:sqlite`, Node `zlib`, TypeScript 7, Zustand 5, ElevenLabs Scribe v2, Vitest 5.

**Spec:** `docs/PROJECT_CONTEXT_BANK_DESIGN.md`

## Global Constraints

- The `.lumen` project remains authoritative; Context Bank analysis may be deleted or regenerated without changing project media or timeline state.
- Persistent Context Bank files remain under `<project directory>/.lumen-context/<project-id>/`; no app-data fallback.
- Source analysis is keyed by the existing bounded source fingerprint, never by a timeline clip position.
- Do not automatically transcribe or deep-analyse every imported episode.
- Preserve existing project `Asset.transcript` phrase timings so captions, pause detection and current tools keep working.
- ElevenLabs Scribe word timestamps are retained when available instead of being discarded after phrase grouping.
- Every stored analysis record carries provider/model/version/provenance sufficient to decide whether it can be reused.
- Large transcript payloads are compressed individually; never compress or load the entire Context Bank as one object.
- AI reads and writes stay behind typed preload/IPC methods and hard item/character limits.
- A changed source fingerprint invalidates reuse of the old source analysis automatically; moving or trimming a timeline clip does not.
- This plan does not implement show-name web research, automatic narration-role detection, resumable task orchestration, or UI cache management; those remain separate follow-up plans.

## Review Focus

- **Source file replaced at the same path:** a new fingerprint must make old transcript/observation data unreachable for the replacement while leaving historical rows harmlessly keyed to the old identity.
- **Missing/offline source:** analysis writes fail clearly when no current fingerprint can be resolved; reads never fall back to path-only identity.
- **Very long narration/episode transcript:** range queries return only requested nearby words/phrases and set `truncated: true` when budgets are exhausted.
- **Provider/model change:** multiple transcription runs may coexist, but lookup selects the newest compatible record deterministically instead of merging incompatible timings.
- **Save As / restart:** transcript and observation records survive the existing checkpointed database copy and reopen exactly as foundation data does.

---

### Task 1: Define reusable analysis contracts without changing existing caption types

**Files:**
- Create: `Lumen-Fixed/shared/context-bank-analysis.ts`
- Create: `Lumen-Fixed/shared/context-bank-analysis.test.ts`
- Modify: `Lumen-Fixed/shared/app.ts`
- Modify: `Lumen-Fixed/electron/preload.ts`

**Interfaces:**
- Produces `ContextBankTranscriptWord = { start: number; end: number; text: string }`.
- Produces `ContextBankTranscriptSegment = { start: number; end: number; text: string }`.
- Produces `ContextBankTranscriptWriteRequest` with `projectPath`, `projectId`, `assetId`, `provider`, `model`, optional `language`, `analysisVersion`, `words`, `segments`, and `createdAt`.
- Produces `ContextBankTranscriptQuery` with `projectPath`, `projectId`, `assetId`, optional `startSeconds`/`endSeconds`, and `maxWords`, `maxSegments`, `maxCharacters` budgets.
- Produces `ContextBankTranscriptResult` with current source fingerprint, provider/model/version metadata, bounded words/segments, `truncated`, and warnings.
- Produces `ContextBankObservationInput`, `ContextBankObservationWriteRequest`, `ContextBankObservationQuery`, and `ContextBankObservationResult` for source-time facts with `kind`, `start`, `end`, `text`, optional `confidence`, primitive provenance, `analysisVersion`, and timestamps.
- Extends `ContextBankAPI` with `putTranscript`, `getTranscript`, `putObservations`, and `getObservations`; no raw SQL/blob API.

- [ ] **Step 1: Write failing contract tests**

Add tests named `accepts monotonic finite transcript timing`, `rejects negative or reversed source ranges`, and `rejects nested or unbounded observation provenance`. Pin `analysisVersion` as a non-empty string, confidence to `0..1`, and transcript/observation text to explicit maximum lengths.

- [ ] **Step 2: Run the contract tests and typecheck before preload wiring**

Run: `cd Lumen-Fixed && npx vitest run shared/context-bank-analysis.test.ts && npm run typecheck`

Expected: FAIL because the analysis contracts/API surface do not yet exist.

- [ ] **Step 3: Add the shared types, validation helpers, IPC channel names and typed preload methods**

Keep the new analysis types in `shared/context-bank-analysis.ts`; import them into `shared/app.ts`. Expose only the four typed methods listed above through preload.

- [ ] **Step 4: Run the contract tests and typecheck**

Run: `npx vitest run shared/context-bank-analysis.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Lumen-Fixed/shared/context-bank-analysis.ts Lumen-Fixed/shared/context-bank-analysis.test.ts Lumen-Fixed/shared/app.ts Lumen-Fixed/electron/preload.ts
git commit -m "feat: define reusable Context Bank analysis contracts"
```

### Task 2: Migrate the Context Bank to schema v2 and persist source transcripts

**Files:**
- Modify: `Lumen-Fixed/electron/context-bank.ts`
- Modify: `Lumen-Fixed/electron/context-bank.test.ts`
- Create: `Lumen-Fixed/electron/context-bank-analysis.test.ts`
- Modify: `Lumen-Fixed/electron/context-bank-copy.test.ts`
- Modify: `Lumen-Fixed/electron/app-ipc.ts`

**Interfaces:**
- Produces schema version `2` with `source_transcripts` and `source_observations` tables.
- Produces store methods `putTranscript(request: ContextBankTranscriptWriteRequest)` and `getTranscript(query: ContextBankTranscriptQuery)`.
- `source_transcripts` stores one gzip payload per transcription run and metadata needed for deterministic selection.
- Transcript IPC handlers resolve through the trusted app IPC boundary; the renderer never supplies SQL or an authoritative fingerprint.

- [ ] **Step 1: Write migration and transcript persistence RED tests**

Cover: a fixture database at schema v1 opens and migrates to v2 without losing assets/clips/edit events; a transcript survives close/reopen; two project IDs remain isolated; gzip payload round-trips exactly; a transcript written before Save As exists in the copied bank after checkpointed copy/reopen.

- [ ] **Step 2: Run the focused tests**

Run: `npx vitest run electron/context-bank.test.ts electron/context-bank-analysis.test.ts electron/context-bank-copy.test.ts`

Expected: FAIL because schema v2 and transcript store methods do not exist.

- [ ] **Step 3: Implement ordered schema migration and individually compressed transcript payloads**

Add a `migrateSchema()` path rather than blindly overwriting `schema_version`. `source_transcripts` includes fingerprint, asset ID at write time, provider, model, language, analysis version, created-at time and gzip JSON payload. Add indexes for fingerprint and created-at. Create the `source_observations` table now so schema v2 is complete, but leave its behavior to Task 5.

- [ ] **Step 4: Resolve transcript writes through the current `source_assets` fingerprint**

Reject writes when `assetId` is not currently registered or has no fingerprint. Never accept a renderer-supplied fingerprint as authoritative. Store old runs under their old fingerprints rather than mutating them when a source later changes.

- [ ] **Step 5: Add trusted transcript IPC handlers**

Register `putTranscript`/`getTranscript` app handlers with the same trusted-sender pattern as the foundation Context Bank API and close the per-call store in `finally`.

- [ ] **Step 6: Run focused tests and Node typecheck**

Run: `npx vitest run electron/context-bank.test.ts electron/context-bank-analysis.test.ts electron/context-bank-copy.test.ts && npx tsc -p tsconfig.node.json`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Lumen-Fixed/electron/context-bank.ts Lumen-Fixed/electron/context-bank.test.ts Lumen-Fixed/electron/context-bank-analysis.test.ts Lumen-Fixed/electron/context-bank-copy.test.ts Lumen-Fixed/electron/app-ipc.ts
git commit -m "feat: persist reusable source transcripts"
```

### Task 3: Make transcript retrieval source-range-aware and budgeted

**Files:**
- Modify: `Lumen-Fixed/electron/context-bank.ts`
- Modify: `Lumen-Fixed/electron/context-bank-analysis.test.ts`

**Interfaces:**
- `getTranscript(query: ContextBankTranscriptQuery): ContextBankTranscriptResult`.
- Selects the newest compatible transcript for the asset's current fingerprint, ordered by `createdAt DESC` with a stable record-ID tie-break.
- Returns only words/segments overlapping `[startSeconds, endSeconds)` when supplied.
- Enforces caller budgets after decompression and sets `truncated: true` instead of returning an unbounded payload.

- [ ] **Step 1: Add failing retrieval tests**

Assert a 10,000-word fixture queried around seconds 120–125 returns only overlapping words/segments; `maxWords`, `maxSegments`, and `maxCharacters` independently cause deterministic truncation; a replacement fingerprint makes the old transcript unavailable; a timeline-only clip move leaves it available; two runs with the same timestamp resolve with the stable tie-break.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run electron/context-bank-analysis.test.ts`

Expected: FAIL on range filtering/budget behavior.

- [ ] **Step 3: Implement range filtering and deterministic budget reduction**

Decompress only the selected source transcript record. Sort words/segments by source start/end and original index. Apply item limits before the character budget; if the serialized result still exceeds the character budget, remove data from the end while retaining provenance and warnings.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run electron/context-bank-analysis.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Lumen-Fixed/electron/context-bank.ts Lumen-Fixed/electron/context-bank-analysis.test.ts
git commit -m "feat: add bounded source transcript retrieval"
```

### Task 4: Preserve ElevenLabs Scribe word timings and write them once to the bank

**Files:**
- Modify: `Lumen-Fixed/shared/integrations.ts`
- Modify: `Lumen-Fixed/electron/integrations/elevenlabs.ts`
- Create: `Lumen-Fixed/electron/integrations/elevenlabs.test.ts` if absent
- Create: `Lumen-Fixed/src/project/context-bank-analysis.ts`
- Create: `Lumen-Fixed/src/project/context-bank-analysis.test.ts`
- Modify: `Lumen-Fixed/src/project/transcribe.ts`

**Interfaces:**
- Extends transcription jobs with optional detailed word timings and transcription metadata without changing existing `Job.transcript` phrase semantics.
- `Job.transcriptWords?: ContextBankTranscriptWord[]`.
- `Job.transcriptMeta?: { provider: 'elevenlabs'; model: 'scribe_v2'; language?: string; analysisVersion: 'scribe_v2-word-v1' }` for Scribe jobs.
- Produces `persistTranscriptAnalysis(assetId: string, detail: ContextBankTranscriptDetail): Promise<void>` in `src/project/context-bank-analysis.ts`; it skips unsaved/browser projects, awaits `flushContextBankWrites()`, then calls `desktop.contextBank.putTranscript`.
- `transcribeMedia(assetId, ...)` keeps its current return type and `Asset.transcript` behavior.

- [ ] **Step 1: Write ElevenLabs shaping RED tests**

Given a Scribe response with word timestamps, assert the finished job retains normalized raw words, still produces the existing caption-sized phrase transcript, records model `scribe_v2`, records the returned language code, and pins `analysisVersion` to `scribe_v2-word-v1`.

- [ ] **Step 2: Write renderer persistence helper RED tests**

Assert `persistTranscriptAnalysis` does nothing for an unsaved project, waits for the Context Bank write barrier before a saved-project write, sends the current project path/ID and asset ID, and converts a bank failure into a logged warning rather than an editor failure.

- [ ] **Step 3: Write `transcribeMedia` RED coverage**

Mock a completed ElevenLabs job and assert the existing phrase transcript remains available to captions/pause removal while the detailed word record is persisted exactly once. Assert ordinary import does not call this helper.

- [ ] **Step 4: Run the focused tests**

Run: `npx vitest run electron/integrations/elevenlabs.test.ts src/project/context-bank-analysis.test.ts`

Expected: FAIL because detailed Scribe metadata is currently discarded and the persistence helper does not exist.

- [ ] **Step 5: Retain detailed Scribe data and persist it after successful ElevenLabs transcription**

Keep the existing `transcribeAsset`/job flow intact. The Context Bank write is supplementary: it must not alter the project dirty flag, duplicate the `Asset.transcript` dispatch, or turn a successful transcription into a failure when cache persistence fails.

- [ ] **Step 6: Run focused tests plus existing transcription/integration tests**

Run: `npx vitest run electron/integrations/elevenlabs.test.ts src/project/context-bank-analysis.test.ts src/project/analysis-actions.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add Lumen-Fixed/shared/integrations.ts Lumen-Fixed/electron/integrations/elevenlabs.ts Lumen-Fixed/electron/integrations/elevenlabs.test.ts Lumen-Fixed/src/project/context-bank-analysis.ts Lumen-Fixed/src/project/context-bank-analysis.test.ts Lumen-Fixed/src/project/transcribe.ts
git commit -m "feat: retain reusable ElevenLabs word transcripts"
```

### Task 5: Add generic source-range observations with provenance

**Files:**
- Modify: `Lumen-Fixed/electron/context-bank.ts`
- Modify: `Lumen-Fixed/electron/context-bank-analysis.test.ts`
- Modify: `Lumen-Fixed/electron/context-bank-copy.test.ts`
- Modify: `Lumen-Fixed/electron/app-ipc.ts`

**Interfaces:**
- `putObservations(request: ContextBankObservationWriteRequest): ContextBankObservationResult` performs idempotent upsert by observation ID after resolving the current fingerprint.
- `getObservations(query: ContextBankObservationQuery): ContextBankObservationResult` filters by current fingerprint, optional source-time range/kind, and strict item/character budgets.
- Observation provenance is explicit (`producer`, optional `model`, optional `source`, `createdAt`) and confidence, when present, is constrained to `0..1`.

- [ ] **Step 1: Add failing observation tests**

Cover overlapping-range retrieval, kind filtering, idempotent repeated write, changed-fingerprint isolation, confidence validation, deterministic ordering, item/character truncation, close/reopen persistence, and Save As preservation.

- [ ] **Step 2: Run the focused tests**

Run: `npx vitest run electron/context-bank-analysis.test.ts electron/context-bank-copy.test.ts`

Expected: FAIL on observation persistence/retrieval.

- [ ] **Step 3: Implement observation store methods**

Resolve each write against the current `source_assets` fingerprint. Store compact text plus primitive provenance metadata; do not permit arbitrary binary data, frame images, or nested unbounded JSON through this API.

- [ ] **Step 4: Add trusted observation IPC handlers**

Register `putObservations`/`getObservations` behind the same trusted-sender boundary and per-call store lifecycle as transcript operations.

- [ ] **Step 5: Run focused tests and Node typecheck**

Run: `npx vitest run electron/context-bank-analysis.test.ts electron/context-bank-copy.test.ts && npx tsc -p tsconfig.node.json`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Lumen-Fixed/electron/context-bank.ts Lumen-Fixed/electron/context-bank-analysis.test.ts Lumen-Fixed/electron/context-bank-copy.test.ts Lumen-Fixed/electron/app-ipc.ts
git commit -m "feat: add reusable source observations"
```

### Task 6: Expose bounded transcript and observation tools to every anime-review AI provider

**Files:**
- Create: `Lumen-Fixed/src/integrations/tools/context-bank-analysis.ts`
- Create: `Lumen-Fixed/src/integrations/tools/context-bank-analysis.test.ts`
- Modify: `Lumen-Fixed/src/integrations/tools/anime-review.ts`
- Modify: `Lumen-Fixed/src/integrations/tools/anime-review.test.ts`

**Interfaces:**
- Produces `get_source_transcript` AI tool: requires `asset_id` and `purpose`; optional source-time range; hard caps returned words/segments/characters.
- Produces `get_source_observations` AI tool: requires `asset_id` and `purpose`; optional range/kind; hard item/character caps.
- Produces `record_source_observation` AI tool for one compact observation with explicit source range, kind, text, provenance source and optional confidence.
- These tools read/write only the Context Bank; they do not automatically invoke transcription, vision, web research, or media analysis.

- [ ] **Step 1: Write registry and bounded-argument RED tests**

Assert all three tools are present exactly once, reject unsaved projects, reject reversed ranges, clamp oversized budgets, and never expose `clear`, arbitrary fingerprints, SQL, or raw compressed payloads.

- [ ] **Step 2: Run the focused tests**

Run: `npx vitest run src/integrations/tools/context-bank-analysis.test.ts src/integrations/tools/anime-review.test.ts`

Expected: FAIL because the analysis tools are not registered.

- [ ] **Step 3: Implement the tools using the typed Context Bank API**

Before reads and observation writes, await `flushContextBankWrites()` so asset/fingerprint registration is current. Do not include full project state in responses. The main process resolves the fingerprint from the supplied asset ID.

- [ ] **Step 4: Run focused tests and app typecheck**

Run: `npx vitest run src/integrations/tools/context-bank-analysis.test.ts src/integrations/tools/anime-review.test.ts && npx tsc -p tsconfig.app.json`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Lumen-Fixed/src/integrations/tools/context-bank-analysis.ts Lumen-Fixed/src/integrations/tools/context-bank-analysis.test.ts Lumen-Fixed/src/integrations/tools/anime-review.ts Lumen-Fixed/src/integrations/tools/anime-review.test.ts
git commit -m "feat: expose reusable source analysis tools"
```

### Task 7: Verify persistence, invalidation and no automatic episode transcription

**Files:**
- Modify tests only where verification finds a gap; do not add unrelated production behavior in this task.

**Interfaces:**
- Verifies Tasks 1–6 as one reusable-analysis milestone.

- [ ] **Step 1: Run the reusable-analysis focused suite**

Run:

```bash
cd Lumen-Fixed
npx vitest run \
  shared/context-bank-analysis.test.ts \
  electron/context-bank.test.ts \
  electron/context-bank-analysis.test.ts \
  electron/context-bank-copy.test.ts \
  electron/integrations/elevenlabs.test.ts \
  src/project/context-bank-analysis.test.ts \
  src/integrations/tools/context-bank-analysis.test.ts \
  src/integrations/tools/anime-review.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full automated gate**

Run: `npm test && npm run typecheck`

Expected: PASS with no skipped Context Bank analysis tests.

- [ ] **Step 3: Pin import behavior**

Add or reuse a media-import test proving ordinary import/probe does not call `transcribeMedia`, ElevenLabs Scribe, `putTranscript`, or any source-observation producer merely because a batch of episode files was imported.

- [ ] **Step 4: Perform the Windows D-drive round-trip when a real desktop checkout is available**

Create/save a project on D:, import a narration file, transcribe it with ElevenLabs, close/reopen Lumen, query a narrow source-time transcript range, make a timeline-only clip move and confirm the same transcript is reused, then replace the source file and confirm the old transcript is no longer returned for that asset.

Expected: Context Bank remains under the D: project folder, word-level transcript survives restart, timeline edits do not invalidate it, and source replacement does.

- [ ] **Step 5: Do not create an empty completion commit**

If automated verification reveals a bug, fix it with a focused test and commit. Otherwise stop with the previous feature commit and report the still-manual Windows round-trip separately.

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

- **Source file replaced at the same path:** a new fingerprint must make an old transcript/observation unreachable for the replacement without deleting historical rows that may still be useful to another source identity.
- **Missing/offline source:** transcript writes must fail clearly when the bank cannot resolve a current fingerprint; existing cached analysis may still be queried only by a currently registered matching source.
- **Very long narration/episode transcript:** range queries must return only requested nearby words/phrases and set `truncated: true` when budgets are exhausted.
- **Provider/model change:** a newer transcription run may coexist with old analysis, but the current lookup must select the newest compatible record deterministically rather than merge incompatible timings.
- **Save As / restart:** transcript and observation records must survive the existing checkpointed database copy and reopen exactly as foundation data does.

---

### Task 1: Define reusable analysis contracts without changing existing caption types

**Files:**
- Create: `Lumen-Fixed/shared/context-bank-analysis.ts`
- Modify: `Lumen-Fixed/shared/app.ts`
- Modify: `Lumen-Fixed/electron/preload.ts`
- Test: `Lumen-Fixed/shared/context-bank-analysis.test.ts`

**Interfaces:**
- Produces `ContextBankTranscriptWord = { start: number; end: number; text: string }`.
- Produces `ContextBankTranscriptSegment = { start: number; end: number; text: string }`.
- Produces `ContextBankTranscriptWriteRequest` with `projectPath`, `projectId`, `assetId`, `provider`, `model`, optional `language`, `analysisVersion`, `words`, `segments`, and `createdAt`.
- Produces `ContextBankTranscriptQuery` with project/source identity, optional source-time range, and `maxWords`, `maxSegments`, `maxCharacters` budgets.
- Produces `ContextBankTranscriptResult` with fingerprint, provenance, bounded words/segments, `truncated`, and warnings.
- Produces `ContextBankObservationInput`, `ContextBankObservationQuery`, `ContextBankObservationResult` for source-time facts with `kind`, `start`, `end`, `text`, optional `confidence`, `provenance`, `analysisVersion`, and timestamps.
- Extends `ContextBankAPI` with `putTranscript`, `getTranscript`, `putObservations`, and `getObservations`; no raw SQL/blob API.

- [ ] **Step 1: Write failing contract tests**

Add tests named `accepts monotonic finite transcript timing`, `rejects negative or reversed source ranges`, and `caps serialized observation metadata to primitive JSON`. Pin `analysisVersion` as a non-empty string and transcript text as finite bounded strings rather than arbitrary objects.

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

### Task 2: Migrate the Context Bank to schema v2 with transcript and observation storage

**Files:**
- Modify: `Lumen-Fixed/electron/context-bank.ts`
- Modify: `Lumen-Fixed/electron/context-bank.test.ts`
- Create: `Lumen-Fixed/electron/context-bank-analysis.test.ts`

**Interfaces:**
- Produces schema version `2` with `source_transcripts` and `source_observations` tables.
- Produces store methods `putTranscript`, `getTranscript`, `putObservations`, and `getObservations` matching Task 1 contracts.
- `source_transcripts` stores one gzip payload per transcription run and metadata needed for deterministic selection.
- `source_observations` stores indexed source-time rows keyed by fingerprint plus observation ID.

- [ ] **Step 1: Write migration and persistence RED tests**

Cover: a fixture database at schema v1 opens and migrates to v2 without losing assets/clips/edit events; a transcript survives close/reopen; observations survive close/reopen; two project IDs remain isolated; gzip payload round-trips exactly.

- [ ] **Step 2: Run the focused tests**

Run: `npx vitest run electron/context-bank.test.ts electron/context-bank-analysis.test.ts`

Expected: FAIL because schema v2 and analysis store methods do not exist.

- [ ] **Step 3: Implement ordered schema migration and individually compressed transcript payloads**

Add a `migrateSchema()` path rather than blindly overwriting `schema_version`. `source_transcripts` must include fingerprint, asset ID at write time, provider, model, language, analysis version, created-at time and gzip JSON payload. Add indexes for fingerprint and created-at. `source_observations` must index `(fingerprint, start_seconds, end_seconds)` and `kind`.

- [ ] **Step 4: Resolve writes through the current `source_assets` fingerprint**

Reject transcript/observation writes when `assetId` is not currently registered or has no fingerprint. Never accept a renderer-supplied fingerprint as authoritative.

- [ ] **Step 5: Run focused tests and Node typecheck**

Run: `npx vitest run electron/context-bank.test.ts electron/context-bank-analysis.test.ts && npx tsc -p tsconfig.node.json`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Lumen-Fixed/electron/context-bank.ts Lumen-Fixed/electron/context-bank.test.ts Lumen-Fixed/electron/context-bank-analysis.test.ts
git commit -m "feat: persist reusable source analysis in Context Bank"
```

### Task 3: Make transcript retrieval source-range-aware and budgeted

**Files:**
- Modify: `Lumen-Fixed/electron/context-bank.ts`
- Modify: `Lumen-Fixed/electron/context-bank-analysis.test.ts`

**Interfaces:**
- `getTranscript(query: ContextBankTranscriptQuery): ContextBankTranscriptResult`.
- Selects the newest deterministic compatible transcript for the asset's current fingerprint.
- Returns only words/segments overlapping `[startSeconds, endSeconds)` when supplied.
- Enforces caller budgets after decompression and sets `truncated: true` instead of returning an unbounded payload.

- [ ] **Step 1: Add failing retrieval tests**

Assert a 10,000-word fixture queried around seconds 120–125 returns only overlapping words/segments; `maxWords`, `maxSegments`, and `maxCharacters` all independently cause deterministic truncation; a replacement fingerprint makes the old transcript unavailable; moving a timeline clip does not.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run electron/context-bank-analysis.test.ts`

Expected: FAIL on range filtering/budget behavior.

- [ ] **Step 3: Implement range filtering and deterministic budget reduction**

Decompress only the selected source transcript record. Sort by source start/end and original index. Apply item limits before the character budget; if the serialized response still exceeds the character budget, remove data from the end while retaining provenance and warnings.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run electron/context-bank-analysis.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Lumen-Fixed/electron/context-bank.ts Lumen-Fixed/electron/context-bank-analysis.test.ts
git commit -m "feat: add bounded source transcript retrieval"
```

### Task 4: Preserve ElevenLabs Scribe word timings and provenance

**Files:**
- Modify: `Lumen-Fixed/shared/integrations.ts`
- Modify: `Lumen-Fixed/electron/integrations/elevenlabs.ts`
- Modify: `Lumen-Fixed/electron/integrations/elevenlabs.test.ts` (create if absent)
- Modify: `Lumen-Fixed/src/integrations/store.ts`
- Modify: `Lumen-Fixed/src/project/transcribe.ts`
- Test: `Lumen-Fixed/src/project/transcribe-context-bank.test.ts`

**Interfaces:**
- Extends transcription jobs with optional detailed word timings and transcription metadata without changing existing `Job.transcript` phrase semantics.
- `Job.transcriptWords?: ContextBankTranscriptWord[]`.
- `Job.transcriptMeta?: { provider: 'elevenlabs'; model: 'scribe_v2'; language?: string; analysisVersion: string }` for Scribe jobs.
- Successful `transcribeMedia(assetId, ...)` continues to return `TranscriptSegment[]` and populate `Asset.transcript`, while also writing detailed analysis to the Context Bank when a saved project and detailed data are available.

- [ ] **Step 1: Write ElevenLabs shaping RED tests**

Given a Scribe response with word timestamps, assert the finished job retains the raw normalized words, still creates the same caption-sized phrase transcript, records `scribe_v2`, and records the returned language code.

- [ ] **Step 2: Write renderer persistence RED tests**

Mock a completed ElevenLabs transcription and assert `Asset.transcript` remains phrase-level for existing features while `contextBank.putTranscript` receives word timings, provider/model/language/version and the matching asset ID exactly once. Assert an unsaved project skips only the bank write, not the project transcript.

- [ ] **Step 3: Run the focused tests**

Run: `npx vitest run electron/integrations/elevenlabs.test.ts src/project/transcribe-context-bank.test.ts`

Expected: FAIL because detailed transcript metadata is currently discarded.

- [ ] **Step 4: Retain detailed Scribe data and persist it after successful transcription**

Do not trigger transcription from import. Do not make Context Bank persistence part of the editor's dirty flag. A Context Bank write failure must warn/log but must not discard a valid completed project transcript.

- [ ] **Step 5: Run focused tests plus existing transcription/integration tests**

Run: `npx vitest run electron/integrations/elevenlabs.test.ts src/project/transcribe-context-bank.test.ts src/project/analysis-actions.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add Lumen-Fixed/shared/integrations.ts Lumen-Fixed/electron/integrations/elevenlabs.ts Lumen-Fixed/electron/integrations/elevenlabs.test.ts Lumen-Fixed/src/integrations/store.ts Lumen-Fixed/src/project/transcribe.ts Lumen-Fixed/src/project/transcribe-context-bank.test.ts
git commit -m "feat: retain reusable ElevenLabs word transcripts"
```

### Task 5: Add generic source-range observations with provenance

**Files:**
- Modify: `Lumen-Fixed/electron/context-bank.ts`
- Modify: `Lumen-Fixed/electron/context-bank-analysis.test.ts`
- Modify: `Lumen-Fixed/electron/app-ipc.ts`

**Interfaces:**
- `putObservations(request): ContextBankObservationResult` performs idempotent upsert by observation ID after resolving the current fingerprint.
- `getObservations(query): ContextBankObservationResult` filters by current fingerprint, optional source-time range/kind, and strict item/character budgets.
- Observation provenance is explicit (`producer`, optional `model`, optional `source`, `createdAt`) and confidence, when present, is constrained to `0..1`.

- [ ] **Step 1: Add failing observation tests**

Cover overlapping-range retrieval, kind filtering, idempotent repeated write, changed fingerprint isolation, confidence validation, deterministic ordering, and item/character truncation.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run electron/context-bank-analysis.test.ts`

Expected: FAIL on observation persistence/retrieval.

- [ ] **Step 3: Implement observation store methods and trusted IPC handlers**

Keep observations compact. Store text plus small primitive provenance metadata; do not permit arbitrary binary data, frame images, or nested unbounded JSON through this API.

- [ ] **Step 4: Run focused tests and Node typecheck**

Run: `npx vitest run electron/context-bank-analysis.test.ts && npx tsc -p tsconfig.node.json`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Lumen-Fixed/electron/context-bank.ts Lumen-Fixed/electron/context-bank-analysis.test.ts Lumen-Fixed/electron/app-ipc.ts
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
- Produces `record_source_observation` AI tool for a single compact observation with explicit range, kind, text, provenance source and optional confidence.
- These tools read/write only the Context Bank; they do not automatically invoke transcription, vision, web research, or media analysis.

- [ ] **Step 1: Write registry and bounded-argument RED tests**

Assert all three tools are present exactly once, reject unsaved projects, reject reversed ranges, clamp oversized budgets, and never expose `clear` or arbitrary fingerprint/SQL fields.

- [ ] **Step 2: Run the focused tests**

Run: `npx vitest run src/integrations/tools/context-bank-analysis.test.ts src/integrations/tools/anime-review.test.ts`

Expected: FAIL because the analysis tools are not registered.

- [ ] **Step 3: Implement the tools using the typed Context Bank API**

Before reads, await `flushContextBankWrites()` just as `query_context_bank` does. Do not include full project state in responses. Observation writes must use current project path/ID and the supplied asset ID; the main process resolves the fingerprint.

- [ ] **Step 4: Run focused tests and app typecheck**

Run: `npx vitest run src/integrations/tools/context-bank-analysis.test.ts src/integrations/tools/anime-review.test.ts && npx tsc -p tsconfig.app.json`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add Lumen-Fixed/src/integrations/tools/context-bank-analysis.ts Lumen-Fixed/src/integrations/tools/context-bank-analysis.test.ts Lumen-Fixed/src/integrations/tools/anime-review.ts Lumen-Fixed/src/integrations/tools/anime-review.test.ts
git commit -m "feat: expose reusable source analysis tools"
```

### Task 7: Verify persistence, invalidation and non-analysis-on-import end to end

**Files:**
- Modify tests only where needed; do not add production behavior for this task.

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
  electron/integrations/elevenlabs.test.ts \
  src/project/transcribe-context-bank.test.ts \
  src/integrations/tools/context-bank-analysis.test.ts \
  src/integrations/tools/anime-review.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the full automated gate**

Run: `npm test && npm run typecheck`

Expected: PASS with no skipped Context Bank analysis tests.

- [ ] **Step 3: Audit import behavior**

Verify with tests or code inspection that ordinary media import only registers/probes assets and does not call `transcribeMedia`, ElevenLabs Scribe, or any source-observation producer merely because twelve episodes were imported.

- [ ] **Step 4: Perform the Windows D-drive round-trip when a real desktop checkout is available**

Create/save a project on D:, import a narration file, transcribe it with ElevenLabs, close/reopen Lumen, query a narrow source-time transcript range, make a timeline-only clip move and confirm the same transcript is reused, then replace the source file and confirm the old transcript is no longer returned for that asset.

Expected: Context Bank remains under the D: project folder, word-level transcript survives restart, timeline edits do not invalidate it, and source replacement does.

- [ ] **Step 5: Do not create an empty completion commit**

If automated verification reveals a bug, fix it with a focused test and commit. Otherwise stop with the previous feature commit and report the still-manual Windows round-trip separately.

# Project Context Bank — Engineering Design (v2)

Status: approved design; implementation and tests pending.
Branch: `feature/anime-review-update-02`.
Goal: analyse once, remember automatically, retrieve precisely, validate edits, and resume long jobs.

## Contract

The Context Bank is a built-in Lumen subsystem, **not** a second editor, independent AI, or external daemon. The project and media remain authoritative. The bank stores reusable research, analysis, derived indexes, task checkpoints and provenance. Every AI provider uses the same bank through stable tool APIs. Do not copy the full bank into model prompts.

The useful mental model is "more efficient eyes": Lumen keeps a progressively clearer, searchable record of what the AI and editor have already learned. More work should make later work cheaper and more precise, not force the model to reconstruct the project again.

## Lifecycle

1. Project creation collects show name, season/adaptation confirmation, project directory, resolution and frame rate. Creation must work offline; research may be deferred. Research results are attributed, dated and labelled as unverified until footage confirms them.
2. Import registers source assets and filename-derived hints, with stable IDs and user corrections. Do not deep-analyse all twelve episodes.
3. Narration on timeline triggers full-source transcription where justified; persist word-level source timestamps, model/provider/version, and audio measurements. Video analysis is range-scoped, guided by show research, and expanded when necessary.
4. Each editing operation observes the canonical editor state, retrieves compact relevant context, validates preconditions, commits through existing undo history, then records the result. Manual edits must also be observed.
5. A long prompt becomes a persisted sequence of bounded tasks with checkpoints and completion criteria. Resume from the last verified checkpoint, not from the last AI message.
6. User can inspect storage, set a quota, and clear regenerable analysis separately from project data. Context-bank files live beside the project on the project drive; they must not silently fall back to the app-data directory on C:.

## Repository-audit decisions

These decisions are now locked for the first implementation rather than left as open architecture questions.

- The `.lumen` project remains the only authority for current editable state. Context records may be repaired or discarded without changing the project.
- The Electron main process owns context-bank persistence. Renderer code never receives unrestricted filesystem access.
- Electron 44 runs a Node 24 line that includes `node:sqlite`, so the first implementation uses Node's built-in `DatabaseSync` rather than adding a native SQLite package. This avoids a new native-addon packaging surface.
- Each saved project gets a sidecar database at `<project directory>/.lumen-context/<project-id>/context.sqlite`. Therefore a project saved on D: keeps its context bank on D:. An unsaved project stays memory-only until it has a project path; later project-creation work will ask for the project location up front.
- SQLite stores compact indexed facts and current timeline mirrors. Large analysis payloads are individually gzip-compressed BLOBs when that phase is added. Never compress/decompress the whole database on project close/open.
- The renderer sends a compact mirror of assets, clips, markers and source mappings after committed editor mutations. The main process reconciles that mirror transactionally and derives normalized edit events. This avoids maintaining a second editable timeline while still remembering where cuts used to be.
- Source analysis is keyed by a content fingerprint, not by timeline position. The first fingerprint implementation uses file size plus SHA-256 over bounded leading/trailing byte samples so a multi-gigabyte episode does not need a full-file hash.
- AI retrieval stays budgeted and range-scoped. The existing `anime-ai-context.ts` packet is extended/enriched where useful; it is not replaced by a second full-project prompt format.

## Data model

The first schema uses SQLite tables for metadata, source assets, current timeline clips/markers, project revisions and edit events. Later migrations add show knowledge, source observations, transcripts and resumable tasks without changing the renderer-facing API.

All records that can become stale carry enough identity to validate them: project ID, source fingerprint, sequence/clip ID when relevant, frame/time range, analysis version, confidence/provenance where applicable, and current/invalidation state.

Logical record groups:
- Show identity, aliases, episodes, character relations and sourced claims.
- Imported asset registry, filename hints, user overrides and fingerprints.
- Source observations: transcript words, pauses, scene boundaries, character candidates, descriptions, search hits/misses.
- Timeline-derived index: current clip-to-source mappings, markers, chapter boundaries and current project revision.
- Edit journal: operation ID, before/after revision, affected IDs/ranges, validation result and optional concise editorial rationale.
- Task plan: prompt, dependencies, allowed ranges, status, retries, checkpoint and approvals.

Store transcript/observations once per source fingerprint and time range; multiple timeline instances reference the same record. Avoid storing duplicate media or full-resolution frame sets.

## Context retrieval

Tools should support `get_context(project, sequence, range, purpose, budget)`, `find_scene(query, episode_hint)`, `get_transcript(source, range)`, `inspect_cut(clip_or_boundary)`, `record_observation(...)`, `get_task_status(...)`, and `clear_regenerable_cache(...)`. Responses return compact structured data with IDs, timestamps, confidence, provenance and explicit truncation, not unbounded prose.

For a proposed cut, map timeline frames to original source time, retrieve nearby word boundaries and measured pauses, check nearby edits and chapter structure, and validate that the change doesn't split a word or create an unintended gap. If more precision is needed, inspect only the local interval. Existing transcription is reused unless fingerprint or analysis version changed.

The bank is consulted automatically by editing workflows where the answer can materially improve safety or placement. The model may also call explicit context tools. The model does not have to remember to "write notes" after every operation; objective state changes are recorded by Lumen itself.

## Consistency and recovery

Never allow a cached note to override current project state. Each derived timeline record carries a bank revision. Reconcile on load and after undo/redo. Invalidate only affected source ranges/derived mappings when media or edits change. Source analysis survives clip movement. A failed edit must not be recorded as successful.

Each mirror reconciliation runs in one SQLite transaction. On startup, the current project mirror is compared with the stored mirror and repaired from the project if they disagree. This makes crash recovery idempotent: the project wins, and the bank catches up.

Save As must preserve accumulated context by relocating/copying the project's sidecar database to the new project directory after the project file is safely written. Moving only the `.lumen` file outside Lumen may lose the sidecar; that is recoverable because current timeline state can be rebuilt, while future UI should warn when non-regenerable context exists.

Cache compression is selective: compressed blobs for bulky cold data, indexed database for fast queries, bounded in-memory hot ranges. Do **not** decompress the whole project on open or recompress the entire database on every close.

## Integration points

- `Lumen-Fixed/src/editor/types.ts`: canonical project, assets, sequences and clip/source mappings.
- `Lumen-Fixed/src/editor/store.ts`: edit mutations, transactions, undo/redo and mutation observation.
- `Lumen-Fixed/src/editor/project-manifest.ts`: existing read-only project export; do not confuse it with the bank.
- `Lumen-Fixed/src/editor/anime-ai-context.ts`: existing range-limited AI context packet; extend rather than duplicate.
- `Lumen-Fixed/src/editor/anime-timeline-operations.ts`: pure marker/timeline inspection and mutation.
- `Lumen-Fixed/src/project/session.ts`: project path lifecycle, Save As, open/new/recovery.
- `Lumen-Fixed/shared/app.ts`, `Lumen-Fixed/electron/preload.ts`, `Lumen-Fixed/electron/app-ipc.ts`: constrained renderer/main-process API boundary.
- `Lumen-Fixed/src/integrations/agent-tools.ts` and `Lumen-Fixed/src/integrations/tools/anime-review.ts`: provider-independent AI tool registry.

## Build phases and acceptance gates

**Phase A — baseline and schema:** resolve existing marker-tool registry regressions first; add shared contracts, SQLite schema/migrations and path tests. No editing behaviour change.

**Phase B — durable bank:** project-side storage, source fingerprinting, source registry, status/clear and Save As relocation. Verify restart and no Context Bank writes to app-data on C:.

**Phase C — timeline mirroring:** committed-mutation events, revision-aware mirror reconciliation for add/move/trim/split/delete, undo/redo and nested sequences. Verify stored state against a fresh full mirror after every test scenario.

**Phase D — reusable analysis:** store/retrieve ElevenLabs transcript and source-range observations; versioned invalidation; research evidence and confidence; focused scene search.

**Phase E — AI workflow:** bounded context retrieval, deterministic preflight checks, operation journal enrichment, resumable task queue and provider-independent tool APIs. Verify model swaps, crash resume and token-budget bounds.

**Phase F — UI and QC:** creation flow with show identity/project location, cache inspector, disk quota/clear controls, research identity confirmation, progress/review, and cut/transition QC.

The implementation is deliberately split into separate plans so each stage can ship and be tested independently. The first plan covers Phases A-C plus the minimal read API needed to prove the bank is useful; research/transcription/task orchestration get their own plans afterward.

Do not assert any phase is complete until typecheck, tests and a real Windows Electron project round-trip pass.

## Non-goals and safeguards

No speculative full-episode indexing on import; no autonomous overwriting of user corrections; no treating online plot summaries as frame-accurate evidence; no duplicated editor state as authority; no automatic destructive cache clearing; no second background service; no new native SQLite dependency; and no promise that the entire Lumen/AI ecosystem writes nothing to C: — the guarantee for this feature is that its own persistent context-bank and scratch data use the chosen project drive.
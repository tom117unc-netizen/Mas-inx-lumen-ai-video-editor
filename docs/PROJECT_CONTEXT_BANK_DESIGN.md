# Project Context Bank — Engineering Design (draft v1)

Status: design only; implementation and tests pending.
Branch: `feature/anime-review-update-02`.
Goal: analyse once, remember automatically, retrieve precisely, validate edits, and resume long jobs.

## Contract

The Context Bank is a built-in Lumen subsystem, **not** a second editor, independent AI, or external daemon. The project and media remain authoritative. The bank stores reusable research, analysis, derived indexes, task checkpoints and provenance. Every AI provider uses the same bank through stable tool APIs. Do not copy the full bank into model prompts.

## Lifecycle

1. Project creation collects show name, season/adaptation confirmation, project directory, resolution and frame rate. Creation must work offline; research may be deferred. Research results are attributed, dated and labelled as unverified until footage confirms them.
2. Import registers source assets and filename-derived hints, with stable IDs and user corrections. Do not deep-analyse all twelve episodes.
3. Narration on timeline triggers full-source transcription where justified; persist word-level source timestamps, model/provider/version, and audio measurements. Video analysis is range-scoped, guided by show research, and expanded when necessary.
4. Each editing operation observes the canonical editor state, retrieves compact relevant context, validates preconditions, commits through existing undo history, then records the result. Manual edits must also be observed.
5. A long prompt becomes a persisted sequence of bounded tasks with checkpoints and completion criteria. Resume from the last verified checkpoint, not from the last AI message.
6. User can inspect storage, set a quota, and clear regenerable analysis separately from project data. Cache and scratch files default to the project drive (e.g. D:); avoid uncontrolled writes to C:.

## Data model

Use a local transactional store (SQLite where Electron's packaging/runtime supports it; verify native module support before selecting the library). Keep large blobs separately under the project directory. Records have project ID, stable source asset ID, source fingerprint, sequence/clip ID when relevant, frame/time range, analysis version, confidence, provenance, created/updated time, and invalidation status.

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

## Consistency and recovery

Never allow a cached note to override current project state. Each derived timeline record carries a project revision; reconcile on load and after undo/redo. Invalidate only affected source ranges/derived mappings when media or edits change. Source analysis survives clip movement. A failed edit must not be recorded as successful. Persist journal/checkpoint atomically where possible; otherwise use an idempotent operation ID and reconcile against canonical project state after a crash.

Cache compression is selective: compressed blobs for bulky cold data, indexed database for fast queries, bounded in-memory hot ranges. Do **not** decompress the whole project on open or recompress the entire database on every close.

## Integration points to inspect before coding

- `src/editor/types.ts`: canonical project, assets, sequences and clip/source mappings.
- `src/editor/store.ts`: edit mutations, undo/redo and revision observation.
- `src/editor/project-manifest.ts`: existing read-only project export; don't confuse it with the bank.
- `src/editor/anime-ai-context.ts`: existing range-limited AI context packet; extend rather than duplicate.
- `src/editor/anime-timeline-operations.ts`: pure marker/timeline inspection and mutation.
- `src/integrations/agent-tools.ts` and `src/integrations/tools/anime-review.ts`: AI tool registry and deterministic editing entry points.
- Electron project save/load and filesystem boundary: ensure no renderer-side unrestricted filesystem writes.

## Build phases and acceptance gates

**Phase A — repository audit and schema:** identify save/load, mutations, tool lifecycle and package constraints; document decisions; add versioned schema and migration tests. No behaviour change.

**Phase B — durable bank:** local storage, source fingerprinting, asset registry, project-drive placement, quotas and cache clearing. Verify offline open, restart and no unwanted C: storage.

**Phase C — timeline mirroring:** revision-aware incremental indexes for add/move/trim/split/delete, undo/redo and nested sequences. Verify consistency against full timeline scan; repair drift without overwriting edits.

**Phase D — reusable analysis:** store/retrieve ElevenLabs transcript and source-range observations; versioned invalidation; research evidence and confidence; focused scene search.

**Phase E — AI workflow:** bounded context retrieval, deterministic preflight checks, operation journal, resumable task queue and provider-independent tool APIs. Verify model swaps, crash resume and token-budget bounds.

**Phase F — UI and QC:** cache inspector, disk quota/clear controls, research identity confirmation, progress and review/approval, cut/transition QC.

Do not assert any phase is complete until typecheck, tests and a real Windows Electron project round-trip pass. Existing marker-tool registration regressions must be resolved before adding further tools.

## Non-goals and safeguards

No speculative full-episode indexing on import; no autonomous overwriting of user corrections; no treating online plot summaries as frame-accurate evidence; no duplicated editor state as authority; no automatic destructive cache clearing; no promise of zero C: writes without verifying Electron, providers and temporary file behaviour.

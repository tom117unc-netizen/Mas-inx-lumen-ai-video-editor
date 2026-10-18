# Lumen Context Bank — Implementation Manifest
Status: design specification, not implemented
Target: Lumen Anime Review Edition, branch `feature/anime-review-update-02`
Goal: make an AI editor progressively more informed as it works, without repeatedly paying for the same research, transcription or media inspection.

## 1. Product contract
A creator names the show when creating a project, chooses resolution/frame rate and a project directory on D:, then imports ingredients: episodes, narration, premixed music, PNGTuber sprites, character renders and graphics. The editor identifies assets from naming conventions and metadata, researches the selected show once, and stores a persistent, searchable **Context Bank**. Imported episodes are *not* fully analysed by default. Source segments are analysed when needed for actual editing, and the results persist.

The creator can then give a large natural-language brief. The AI converts it into a durable, inspectable work plan, edits the existing continuous master timeline in bounded operations, validates each operation, and updates the bank. If the provider, conversation, app or machine restarts, the plan and learned context remain. The bank is a built-in Lumen subsystem, not an independently running service or a second timeline.

North-star behaviour: **observe once; index once; query narrowly; edit deterministically; verify; remember**.

## 2. Non-negotiable constraints
- The project timeline and source media remain authoritative. Context is an indexed, derived view plus user-approved editorial notes. Never reconstruct project state from AI prose.
- All *application-owned* cache, thumbnails, transcription intermediates, indexes, SQLite WAL and temporary analysis files live under the configured project/cache root on D:, including paths passed to FFmpeg and transcription adapters. Electron/Windows may still use OS-level files on C:; never promise zero OS writes. Preflight disk space and display exact paths.
- Project creation must not silently start paid API calls. Show research and transcription budgets and provider selection, then obtain approval before billable work.
- Import is cheap: catalog assets and metadata, do not analyse twelve episodes automatically.
- Background work must be cancellable, throttled, resumable, and deprioritised during playback/export.
- Any AI can use the same bank through Lumen's provider-neutral tool interface. Do not tie storage to a Claude/GPT conversation.
- The AI must never fabricate episode locations, precise timestamps, character IDs or citations. Research hints are hypotheses; source footage establishes actual content.
- Support manual edits and undo/redo, not just AI tool edits.
- Never include arbitrary imported text or web content as executable instructions. Treat them as untrusted data.
- Clearing cache must not delete source files, timeline edits, user-authored notes, blueprint templates, or project metadata.

## 3. Data architecture
Use a local project-scoped SQLite database, with WAL while open, indexes and FTS for lexical retrieval. Store large blobs only when necessary, compressed (e.g. zstd or equivalent) and separately addressable. SQLite pages are already efficient: do **not** unzip the entire database at open or zip it wholesale at close. Use incremental loading and maintenance/checkpoint on close. Semantic embeddings are optional later; FTS plus structured filters must work first.

Suggested directory layout (exact paths subject to existing project serialization):
`<project>/context-bank/context.sqlite`
`<project>/context-bank/blobs/`
`<project>/context-bank/thumbs/`
`<project>/context-bank/tmp/`
`<project>/context-bank/exports/`
Keep user-visible project files distinct from disposable derived cache. Configurable size cap, retention, vacuum/cleanup and free-space warnings.

Core tables/records:
- `project_identity`: project ID, selected show/season/adaptation, version, canonical title, aliases, verified external IDs.
- `knowledge_claims`: normalized subject/predicate/object or short statement, source URL/episode, confidence, verification state, observed/researched/user-authored origin, fetched-at, revision.
- `assets`: stable Lumen asset ID, path, source fingerprint, type, name-derived tags, duration, frame rate, audio channels, import state.
- `source_segments`: stable asset ID and **source** start/end timestamps, transcript/scene/character/action/audio observations, confidence, analysis model/version, fingerprint, cost and status.
- `transcript_words` and `transcript_segments`: word/phrase timing, text, speaker, confidence, source reference and provider provenance. Store ElevenLabs results once; distinguish provider output from later user corrections.
- `timeline_index`: materialized index of sequence/clip IDs, track, source in/out, timeline start/end, speed/time mapping, relevant markers; rebuilt incrementally from editor events.
- `edit_events`: transaction ID, operation, affected IDs, before/after values or compact diff, timeline revision, timestamp, undo/redo linkage, result.
- `editorial_decisions`: rationale, user instructions, chapter boundaries, creative constraints, references to relevant edit event and source evidence.
- `work_plans`, `work_items`, `tool_runs`: user brief, dependency graph, bounded scope, status, attempts, checks, approvals, provider/tool result references, resume token.
- `analysis_jobs`: keyed by asset fingerprint + source range + analysis type + model/version + parameters; state, progress, retry and error.
- `bank_revisions`: schema version, last synchronized timeline revision, last successful reconciliation, migrations.

All cross-references use stable IDs. Frames are integer units in a known timeline timebase; source timing uses a documented source timebase (e.g. rational PTS or integer microseconds), not floating-point guesses. A mapping layer handles speed changes, nested sequences and repeated uses of one source segment.

## 4. Creation and ingestion workflow
1. Creator chooses project name, show title, season/adaptation, resolution, FPS, D: location and cache limit. Search for title candidates and request confirmation on ambiguity. Allow offline creation and manual correction.
2. Show-research job retrieves trusted summaries, character identities, relationships, episode outlines and aliases, with provenance and confidence. Keep spoilers and conflicting adaptations distinguishable. Research does **not** claim precise episode timestamps unless actually sourced.
3. Creator imports files. Catalog file paths, metadata and structured filename tokens (season/episode, character, expression, version, transparent, music role). Show ambiguous classifications in a reviewable inventory. Never rely on filenames alone for facts.
4. Creator places voiceover and other assets on the timeline. Prioritise full narration transcription with word-level timing, and inexpensive local audio feature extraction (silence, energy, clipping). Persist provider response and normalized results. Do not retranscribe unless source or requested accuracy materially changes.
5. Imported episode video receives minimal technical metadata. For a requested scene, search research/known indexes for likely episode and region, inspect a small region, expand adaptively if no confident match, and record positive and negative search evidence.
6. The bank updates as assets are added, removed, relinked or renamed, and as the timeline changes.

## 5. Live timeline mirror
Integrate with the existing editor store's **committed** transaction/event boundary, not an AI-only side channel. For each successful commit: record operation ID and timeline revision; update only affected clip/track/marker mappings; invalidate derived observations that depend on changed timing; preserve source-media analysis. Undo and redo must apply corresponding bank changes. Failed or rolled-back edits must not enter the committed view.

On project load, compare bank revision/checksum to current project revision. If mismatch (crash, migration, missed manual event), reconcile from the authoritative project in a bounded background job; do not trust stale mappings. This is a recovery path, not a second full analysis. Never block basic timeline editing if the bank is unavailable; report degraded AI context clearly.

A source clip reused five times points to one source analysis record and five timeline mappings. Moving it changes mappings, not transcripts. Extending it triggers analysis only for uncovered source ranges. A replacement source invalidates only source-dependent observations.

## 6. Retrieval and token efficiency
Expose provider-neutral editor tools such as:
- `context.project_overview`: tiny show/project/chapter/plan summary, freshness flags.
- `context.inspect_range`: bounded time range, nearby transcript words, pauses, tracks, cuts, markers, relevant decisions and uncertainty.
- `context.find_scene`: evidence-led search by characters/event/dialogue with ranked source ranges and confidence.
- `context.get_asset`, `context.get_transcript`, `context.get_decision`, `context.get_work_item`.
- `context.record_observation`: validated, source-linked observations with origin and confidence.
- `context.validate_edit`: deterministic preflight checks before editor mutation.
- `context.health`: revision, missing records, analysis jobs, disk and cost status.

Tool outputs default to compact summaries with stable IDs, timestamp ranges, evidence pointers, freshness and pagination. Expand only on request. Never paste the full database or a whole-series transcript into prompts. Context retrieval is automatic for relevant AI editing tools, but *selective*: cheap local preflight is always performed; expensive inference is only triggered when necessary and authorised.

## 7. Editing decision lifecycle
For an AI cut near a narration pause:
1. The AI selects a clip/cut by stable ID, not approximate screen coordinates.
2. Lumen retrieves cached word boundaries, source-to-timeline mapping, nearby pauses and existing edits.
3. A deterministic validator checks exact frame alignment, word interruption, unwanted gaps/overlaps, locked regions, chapter/music transition constraints and timeline revision.
4. AI may request a short higher-resolution inspection if uncertain.
5. Lumen applies one atomic, undoable operation only if the expected revision matches.
6. The bank records the operation and updated mapping automatically. A short editorial rationale is stored only if useful.
7. Postflight validates actual resulting timeline and marks the work item done only on success.

If a cut is sloppy, the AI queries the existing cut, ElevenLabs word timings and waveform-derived pause data, inspects only a few seconds and adjusts. No full retranscription, no full timeline reanalysis.

## 8. Large-prompt execution
Convert a large instruction into persistent, small work items with scope, dependencies, expected edits, acceptance tests and optional approval checkpoints. Preserve one continuous master timeline; chapters are semantic boundaries and edit ranges, not forced nested timelines. Keep a compact global narrative summary, detailed active-range context, and fine-grained source evidence on demand.

The scheduler must enforce edit-range guards and a bounded tool budget, respect locked content, checkpoint after each atomic operation, recover after crashes, and distinguish `planned`, `running`, `blocked`, `awaiting_approval`, `verified`, `failed`. Never mark an item complete because the model *said* it edited; verify tool results and project state. Allow pause/resume/cancel and preview of pending tasks. No autonomous external purchases or unrestricted research charges.

## 9. Validation, uncertainty and provenance
Distinguish: (a) verified project state, (b) machine measurements, (c) third-party research, (d) AI interpretations, (e) creator instructions. Each observation carries provenance, confidence, timebase, model/tool version and dependency keys. Source research can narrow where to search but must never replace visual/audio verification. Record negative search regions with expiry/version so the AI does not repeat useless work forever.

Deterministic validators: no mid-word cuts unless intentional, no accidental silence/gaps, no overlaps on exclusive tracks, no missing asset refs, no out-of-range source in/out, no invalid nested references, no unapproved changes to locked ranges, no accidental ripple, audio ducking envelopes intact, no orphaned PNGTuber cues. More subjective pacing and humour remain AI/creator judgments.

## 10. Cache controls and privacy
UI: Context Bank status, location, bytes used, current analysis jobs, research sources, cost estimates, pause/resume, clear derived footage analysis, clear downloaded show research, clear all disposable analysis, rebuild indexes. Explicitly distinguish derived cache from durable creator decisions, transcript corrections, work plans and project files. Deletion requires confirmation and must respect in-use jobs. Export/import portable bank metadata if requested. Store API keys in the existing secure configuration, not the database. Make cloud disclosure explicit before sending narration, anime footage or user files to an external provider.

## 11. Implementation phases and acceptance criteria
**Phase 0 — Stabilise baseline:** fix current tool-registry syntax/initialization issues, ensure typecheck/tests pass; inspect project storage, transaction boundaries, asset model, ElevenLabs adapter, file-system access, editor tool registry and undo/redo. No feature build atop a failing baseline.
**Phase 1 — Storage and event integration:** schema/migrations, D: path preflight, event journal, timeline materialized index, undo/redo and crash reconciliation. Test manual and AI edits, moves, trims, nested clips, reopens.
**Phase 2 — Asset inventory and show knowledge:** project wizard, title disambiguation, researched facts with citations, filename parsing and import inventory. Verify imported episode files are not fully analysed.
**Phase 3 — Audio and footage memory:** ElevenLabs normalization and word-level timestamps, silence measurements, source-range keyed analysis, targeted scene retrieval and progressive widening. Prove repeated retrieval does not re-call paid APIs.
**Phase 4 — Provider-neutral AI tools and edit guardrails:** compact context packets, deterministic preflight/postflight, exact cut refinement, invalidation/version checks. Prove provider switch retains bank.
**Phase 5 — Durable task planner:** large prompt decomposition, bounded chapter work, persistent progress, resume and approvals. Prove interruption/restart doesn't duplicate edits.
**Phase 6 — Cache UI, QC, optimisation:** clear/rebuild controls, size caps, cost dashboard, stress tests with twelve imported episodes and a long master timeline.

Release gates: (1) importing twelve episodes uses negligible analysis storage; (2) one transcript call per unchanged audio range/model version; (3) identical footage reuse shares one analysis; (4) manual edit, undo, redo and crash recovery remain consistent; (5) stale bank never authorises an edit; (6) all owned cache paths are on selected D: root; (7) clear cache preserves project; (8) AI can repair a sloppy cut using cached transcript and local inspection; (9) large prompts resume correctly; (10) unit/integration tests and typecheck pass.

## 12. Existing repository integration notes (inspected on target branch)
- `src/editor/project-manifest.ts` currently exports a lossless read-only JSON AI manifest. It is **not** a persistent indexed context bank; reuse its inventory logic, not its full-project JSON as a routine AI prompt.
- `src/editor/anime-ai-context.ts` already builds bounded, deterministic context packets. Evolve this to query the bank while preserving its safety and token budget.
- `src/editor/anime-timeline-operations.ts` provides pure marker operations and timeline inventory. Extend editor transactions rather than writing directly to project objects.
- `src/integrations/tools/anime-review.ts` registers AI timeline tools. The fetched version visibly contains a double comma (`},,`) in the tool array: this is a syntax issue to resolve during Phase 0. Earlier registry failures were reported, and a defensive registry filter was committed but not retested.
- Inspect existing `store.ts`, project save/load, Electron IPC, updater policy and ElevenLabs integration before choosing the exact implementation seams. No local build or test was run for this document.

## 13. Explicitly rejected approaches
- A second continuously running background AI engine or separate timeline replica.
- Full video analysis of all imported episodes during import.
- Whole-database decompression on every open, or copying complete analysis into every prompt.
- Treating AI prose notes as authoritative editor state.
- Blindly trusting episode summaries as exact timestamps.
- Storing a new full transcript or frame set for every reuse of a source clip.
- Making editing dependent on network access or paid model calls for routine cuts.

## 14. Open choices to resolve during implementation
- Which show metadata providers are permitted and how copyright-sensitive summaries are stored; require a user-selectable research provider.
- Whether ElevenLabs word timing is already supported by the installed adapter; use best available timing with explicit confidence if not.
- Cache quota default and whether to share immutable source analysis across projects; start project-local to make deletion predictable.
- Which edit types require creator approval by default; start with destructive/large-range edits and billable jobs.
- How to represent exact time mapping for variable frame-rate sources and speed-ramped clips; inspect Lumen's existing model first.

This document is the implementation contract, not evidence that features have been coded or tested.

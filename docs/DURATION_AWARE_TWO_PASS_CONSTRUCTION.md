# Duration-aware, two-pass video construction

Implemented on `feature/contextual-video-construction` on 14 November 2026. The full source recording must be present on the authorised current timeline. This builds on the existing local Context Bank, transcripts, saved construction stage, evidence receipts and bounded AI task chain.

## Design goal

The model should **know the story of the whole recording** while actually **editing only a small local section** at a time, without loading hours of source imagery or audio into each prompt. No fixed chunk size is suitable for both a five-minute review and a six-hour stream.

1. **Discover the permitted footage** in bounded 60-second scan calls. Record time-coded candidate signals and source provenance.
2. **Global context banking:** Once all discovery scan intervals are accounted for, Lumen plans analysis sections for the original timeline and asks the model to inspect them. It saves a brief grounded section summary, time-indexed key moments, uncertainty notes and actual inspector receipt IDs. Source-level transcript and detailed observation records remain independently available through the existing Context Bank via `get_source_transcript` and `get_source_observations`.
3. **Focused editing:** Once **all** context sections are banked, Lumen can inspect and map one short editing section at a time. Its `get_construction_edit_context` query searches **every saved context section**, returns local plus explicitly linked and query-relevant distant sections, and gives relevant source asset IDs for further Context Bank lookups. This avoids sending the whole video or all observations to the model. The model then records concrete story beats/cut proposals and calls `record_construction_edit_section` with its actual local evidence.
4. **Assembly and review:** Only after all local edit sections are planned and all existing audiovisual and contextual cut validations succeed may construction apply removals. Post-edit join and whole-output review remains required. **This is still the existing deletion-first engine**, not yet a keep-first, reorderable edit-decision-list assembler.

## Duration-aware initial targets

| Total authorised footage | Context-bank target | Local editing target |
|---|---:|---:|
| At most 10 min | 90 sec | 30 sec |
| 10 min–1 hour | 3 min | 1 min |
| 1–3 hours | 5 min | 90 sec |
| More than 3 hours | 8 min | 2 min |

These are initial partition **targets**, not forced cut points. Sections stay completely inside the authorised timeline range, respect gaps and prefer discovered source clip/scene boundaries to arbitrary minute marks. Editing sections shrink in areas with dense event observations; they need not be equal-sized.

The Context Bank is the *knowledge pass*; the editing section is the *working-footage window*. An edit section may overlap multiple bank sections and can query any other bank section for callbacks, rules, setup, payoff or round/night continuity.

## Core tools

- `begin_video_construction` creates duration-scaled planned context and edit section inventories, after confirming a saved project and authorised timeline.
- `scan_construction_events` discovers events in <=60 seconds per call. **After the final whole-timeline scan**, the section plan is recalculated to take detected event boundaries into account. No bank summary is invalidated by this: context banking has not begun yet.
- `get_video_construction` now exposes `sectionPlan`, the next unbanked/edit section, a bounded `next_context_probe` that automatically skips already inspected intervals, and saved inspection IDs for the active context section. It paginates detailed records rather than dumping the full stream to the model.
- `record_construction_context_section` requires covering audiovisual inspection receipts, saves its summary, key moments and uncertainties, and reuses that evidence as broad source-coverage metadata. A sampled overview is **not** proof of having watched all frames or semantically heard each sound.
- `get_construction_edit_context` returns a bounded, ranked selection of evidence-backed context from **all** banked sections. Local and explicitly linked sections take priority. Duplicate identical lookups are idempotent. It saves a read receipt so the editor must demonstrate it consulted global context.
- `record_construction_edit_section` requires a saved global context read, an actual local inspection, and an overlapping story beat before the section can be marked planned.
- `apply_video_construction` rejects a sectioned plan when any global bank section or local edit section remains unfinished, in addition to all earlier cut/candidate/word-boundary protection.

The autonomous model planner now handles the `context-bank` stage. During banking it handles the next **<=60-second uninspected gap** of a context section rather than repeatedly viewing already-covered windows. Once context is finished, it addresses local editing sections and pulls global related context on demand.

## Evidence and invalidation

Banked summaries are stored **inside the saved .lumen construction state**. Underlying per-source transcripts and observations remain in the separate existing Context Bank. These are related but different layers: timeline bank summaries preserve current placement and narrative links, source bank records preserve detailed media-source evidence.

A changed global context summary invalidates existing local edit plans and cross-scene cut-context receipts, preventing a stale decision from silently passing after the model learns a new setup or callback. A changed original timeline fingerprint still invalidates the whole active plan. Legacy saved construction plans without section inventory retain their older behaviour and are not silently converted.

## Limitations

This phase is a **scheduler + indexed editorial memory**, not an independent semantic recognizer. It cannot guarantee that a sampled inspection saw a 100 ms silent cue or identified a joke. Remote model calls can time out; the short-call chain, persistence and bounded retries make interruptions recoverable, not impossible. It still requires real source-grounded judgement for storytelling, delivery, event classification, and cut placement.

Very long footage still requires multiple per-minute discovery and inspection calls. A future local batch indexing worker would reduce that overhead further. The existing editor still removes timeline ranges rather than building a new reversible sequence; preserving original source spans, a proper keep-first arranger, independent semantic output critic and real multi-hour acceptance tests remain next.

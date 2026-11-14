# Lumen autonomous video construction — architecture gap review

**Baseline:** `feature/contextual-video-construction`, commit `e1db5621179086734e3b3c285f6dc0b0d3b0d1c6` (14 Nov 2026). The corresponding Windows Actions workflow passed, including tests, typecheck, build and installer packaging.

**Desired behaviour:** Given only the footage already placed on the active timeline, identify every significant moment with sufficient audiovisual context; build a coherent, engaging gaming video with its own setup/payoff structure; preserve natural spoken reactions, jokes and game continuity; apply frame-precise edits; independently review and correct the result. The user supplies the goal, not a manual list of timestamps.

**Scope of this review:** Static examination of the current source code and tests. No real gameplay recordings were available for perceptual acceptance. CI success is not evidence of editorial quality.

## Decision

Current foundations are good at **validating a model-proposed removal** and at persisting tool receipts. They are not yet an end-to-end story-construction system. Treat them as a safety layer. Build a separate discovery/planning/reconstruction engine above them rather than adding more prompt instructions to the same loop.

## P0 — issues blocking the intended goal

### 1. There is no guaranteed high-recall event discovery

- `inspect_video_range` in `src/integrations/tools/video-construction.ts` samples **at most 12 video frames in a 60-second window** and obtains transcript/audio metrics. Its receipt marks the entire window covered (`audio: true`); `validateRecords` in `src/editor/video-construction.ts` accepts it as full audiovisual range evidence.
- Any brief silent event, untranscribed joke reaction, visual setup, transition between nights, game objective, or key action between frames can be missed while the coverage gate is satisfied.
- `inspect_cut_context` retrieves existing beat links and lexical transcript leads; it cannot discover a callback the model never entered into the beat map.
- **Remedy:** A multi-resolution timeline index created before storytelling. Segment the current timeline into bounded audio/visual units; cache source-coordinate identity, timed transcript availability, speech/non-speech audio activity, scene changes, motion, game-state/round transitions where detectable, and uncertain intervals. Triage windows by salience/novelty, but explicitly keep an `unexamined` state; never treat sparse frames as continuous confirmation. Escalate suspicious windows to dense pictures plus short real audio. Store event candidates with source clip ID, timeline range, evidence provenance, confidence, and a reason to revisit.
- **Gate:** An inspection coverage receipt must distinguish `overview` from `verified`; the final removal gate demands verified evidence over the specific removed interval and surrounding context, not just a 12-frame sample of a minute.
- **Acceptance:** A held-out fixture with brief silent visual events deliberately placed between overview sample points must be found or declared unresolved, never silently certified safe to remove.

### 2. The construction engine currently plans deletions, not a finished film

- `ConstructionCut` and `apply_video_construction` only describe/remove half-open frame ranges with `timeline.removeRange`; the tool has no selected-clip output sequence, narrative arrangement, intentional chapter opening, or hook/recap strategy.
- It can shorten a chronological recording, but the intended goal is a complete structured video whose sections each have a role (cold open, challenge explanation, night/round start, tension, payoff, ending).
- **Remedy:** Build a *keep-first* editorial decision representation: `SourceSpan {clipId, sourceIn, sourceOut, originalTimelineFrames}`, `StoryMoment {id, type, significance, setupIds, payoffIds, evidence, certainty}`, `SequenceSection {purpose, requiredMomentIds, targetDuration, orderConstraints}`, and `EditDecision {spanIds, outputOrder, handles, audioPolicy}`. Preserve the distinction between source order and story order. Assembly may stay chronological within rounds but can select or reorder moment groups when justified. Explicitly prohibit unapproved outside-timeline footage.
- **Gate:** Validate that every final segment maps to a permitted original timeline source; every required chapter and setup/payoff anchor survives; duration/section budget and output provenance match the plan.
- **Acceptance:** A multi-night challenge fixture must produce an intelligible opening, initial rules, beginning and outcome for each night, complete joke arcs, and an ending without the user providing timestamps.

### 3. A repair cannot restore a wrongly excluded moment

- `begin_construction_repair` calls `beginConstruction(p,...)` on the **already-shortened project**; removed ranges cannot be selected under the stated current-timeline-only rule. An earlier failed cut may have permanently erased an essential setup from the candidate pool.
- **Remedy:** Snapshot an immutable, authorised *original timeline source manifest* and source mapping at construction start. Build output as a non-destructive derived sequence from those *initially authorised* source intervals. Repair changes the selection/output EDL and re-renders; it does not broaden the source pool. Preserve an atomic undo/checkpoint. Reproducibly compare output source provenance to the original manifest.
- **Gate:** A reviewer can reject a missing payoff/setup and the next repair can restore it from the original authorised inputs without media imports or manual undo.
- **Acceptance:** Deliberately discard the only setup in the first pass; the next pass must restore it while still rejecting any asset that never belonged to the original permitted timeline.

### 4. Post-edit narrative completion is mostly model self-attestation

- `review_video_construction` checks overview evidence, join frames and PCM reports, then accepts self-reported story/pacing text plus an empty issues list. `assessVideoQuality` is primarily structural (invalid timing, missing assets, overlapping audio); it does not check a missing explanation, missing night outcomes, complete joke arc, pacing or watchability.
- **Remedy:** A distinct reviewer pass, deliberately given the planned beat map, *newly rendered output*, original required-moment inventory and evidence trace. Require explicit scored criteria, coverage of all protected beats and unanswered questions, and reasons supported by output-frame/audio evidence. Do not let the same free-form `issues: []` be the only semantic completion gate. Use independently measured structural and coverage invariants; send uncertain perceptual issues to a model/human.
- **Acceptance:** Hidden tests with intentionally swapped/missing challenge outcomes and delayed punchlines must fail the review even when timeline integrity and PCM join checks pass.

## P1 — reliability and quality

### 5. Long-form autonomy is bottlenecked by per-window calls and count-only progress

- `constructionContinuation` and `agent.ts` permit 12 continuation batches of 24 model steps (plus the initial batch). At 60 seconds per overview call, four hours means **240 overview calls alone**, before story mapping, paired boundary inspections and per-cut context tools.
- Progress snapshots count records, not their revisions. Updating a 30-beat plan to correct its content while retaining 30 records can be incorrectly classified as no progress.
- **Remedy:** A bounded `index_timeline` job that scans/cache-reduces chunks in the editor/worker, emitting compact event records, progress percent, uncertainty hotspots and cost/time budgets. Use the LLM for high-value interpretation and story decisions, not one API call per fixed minute. Track stable revision/checkpoint identifiers or content fingerprints, not just counts. Resume at meaningful work units; page indexed events.
- **Acceptance:** A six-hour synthetic timeline indexes without 360+ Copilot tool calls and resumes after a mid-job interruption without losing scan position.

### 6. Cut edges are visually precise, not yet perceptually safe

- The current gate requires single frames at edges and rejects overlap with available **phrase-level** transcripts. Missing or inaccurate transcripts can miss chopped speech; a phrase-level gate can over-reject natural boundaries between words.
- `inspect_construction_join_audio` only checks waveform step/level shifts after applying the edit. It can miss semantic clashes, interrupted game sounds, music phrasing and lost laughter. Applying `timeline.removeRange` with no `keepWhole` policy cuts all unlocked tracks, including music and ambience.
- **Remedy:** Generate pre-apply A/B join previews with short audio handles around candidate edges. Align to word-level timing when available; test speech onset/end, audio envelopes, effects/music continuity and visual movement phase. Add explicit handling for continuous ambience/music beds (`keepWhole` or replacement mix) and track-group sync.
- **Acceptance:** For held-out dialogue/music/gameplay clips, no clipped syllables, unintended audio pops, premature laugh removal, visual mid-motion jumps or unwanted music discontinuities.

### 7. Dependency protection is too broad

- In `validateConstructionCuts`, if a retained beat depends on a setup beat, *any* proposed cut overlapping that setup beat is rejected. This forbids trimming irrelevant pauses within a setup scene, hurting the aggressive pacing goal.
- **Remedy:** Distinguish a broad beat from its small *essential evidence anchors*; protect anchors and their minimum lead-in/lead-out handles, not all footage in the beat. Preserve dependency semantics while allowing interior trimming outside the anchors.
- **Acceptance:** A setup with 20 seconds of redundant waiting and a 2-second essential line can lose the waiting while keeping the line and later payoff.

### 8. Audio understanding is transported, not yet verified

- `inspect_construction_audio` can render a timed WAV and hand it to a selected Gemini model, but the repo's tests verify only routing, payload length/header and receipt persistence. `record_construction_audio_observation` accepts a model's claim as an observation if the sample ID exists; the system cannot independently prove that the model received and understood the WAV. Model-name checks rely on a broad `gemini-` prefix.
- **Remedy:** Add a positive downstream receipt created **after successful provider consumption** of a sample, with provider/model ID and observed acoustic output; bound costs/requests and detect unsupported model variants. Keep multimodal transcript/visual/audio evidence separate. Assess real false positives and negatives for laughter, speech delivery and game sounds.
- **Acceptance:** A model without audio gets no verified-listening receipt; a supported model must accurately discriminate speech, laughter, loud game sound and silence on a labeled fixture before semantic audio findings can clear an edit.

### 9. Failure/undo/recovery needs stronger atomicity

- `apply_video_construction` mutates the timeline transaction, then separately persists construction metadata. A failed project save can leave edits applied in memory with an unsuccessful durable checkpoint; review/restart semantics also depend on fingerprints of the edited state.
- **Remedy:** Preserve pre-apply source manifest and atomic rollback/recovery state; do not report successful completion until both edit operation and durable plan checkpoint are recoverable. Include restart/reopen/undo/export fault-injection tests.
- **Acceptance:** Simulated failure between edit and save yields a recoverable original project, not a partially committed ambiguous state.

## Recommended implementation order

1. **P0 index and event inventory:** high-recall, scene/round/night detection, uncertainty flags and stable source mapping. Integrate existing `get_source_transcript` / `get_source_observations` Context Bank caches and still/audio tools instead of redoing work.
2. **P0 keep-first story planner and immutable source manifest:** candidate selection with explicit purposes, dependencies, order and target duration; non-destructive preview.
3. **P0 EDL assembler and safe join preflight:** render selected spans from original authorised source material, obey protected audio/music policies, generate join A/B evidence before output changes.
4. **P0 independent critic and actual restoration loop:** reconstruct from the immutable original timeline on failure, not from already shortened output.
5. **P1 scalable worker checkpoints and revised progress logic:** automation must process hours of footage without hundreds of per-minute chat actions.
6. **P1 audio quality enhancement and failure injection:** real model listening on selected uncertain clips plus tested provider receipts and save/rollback fault coverage.

These are **proposed changes, not implemented features**. The current code and 552 automated tests remain valuable regression coverage but do not measure the desired editorial outcome.

## Smallest meaningful acceptance milestone

Construct a **single 3–8 minute YapYap-style challenge excerpt** from held-out footage with two separate rounds/nights, a rule explanation, a silent setup, an interrupted phrase, a delayed spoken callback, a gameplay sound, a meaningful death/outcome and a false-positive loud noise. The user gives only the footage-on-timeline and editorial goal. Human ground truth is hidden from the editing model.

The test succeeds only if:
- Each round/night retains a beginning and outcome; rules are comprehensible without the source recording
- The setup and delayed payoff both survive; irrelevant waiting is substantially shortened
- No selected footage comes from outside the initial authorised timeline
- At least one deliberately unsafe candidate cut is rejected with an evidence-backed reason
- A deliberately removed essential beat is restored during repair from the original authorised manifest
- The output can be saved, reopened and exported; all review/repair decisions and source mappings persist

Once that milestone is reliable, scale to 30-minute, two-hour and then six-hour projects. Measure missed moments, false-positive highlights, edit density, output watchability, unrepairable errors, tool calls, model cost and elapsed edit time as separate axes.

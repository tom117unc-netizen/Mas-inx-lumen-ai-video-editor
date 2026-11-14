# Lumen — second video creation and accuracy audit

**Audit baseline:** `feature/contextual-video-construction`, `cdb92a463b54e0b8eee2d1b74ab4999d75b69f1d`, 14 November 2026. The head commit has successful Windows CI runs (automated tests, typecheck, production build and installer packaging). This is a **source inspection**, not a real-footage acceptance run.

**Intended output:** From only the video/audio already placed on the open timeline, autonomously identify important moments in long gaming recordings, discover setup/payoff relationships, build a comprehensible hook-to-ending story, preserve expressive personality and naturally timed reactions, make precise audio/visual edits, independently criticize the resulting edit and repair failures without inventing events or importing unauthorised media.

## Executive conclusion

The current project has robust *mechanical guardrails around proposed deletions* but still lacks a grounded, complete video-creation engine. High-priority fixes are needed to stop **false safety confirmations** in discovery. After those, the dominant creative-quality upgrade is a keep-first story model and non-destructive source-backed output assembler.

## Confirmed code-level accuracy gaps

### P0-A — New passes can entirely skip discovery

**Code:** `src/editor/video-construction.ts:175-177` and `:213-216`.

`validateConstructionCuts` checks the unscanned discovery ranges **only when** `s.discoveryScans?.length` is non-zero. A newly created plan has an empty array, so it can pass deletion validation with conventional coarse coverage and zero discovery scans. `constructionStatus` similarly enters `investigate` rather than `discover` when no scan has begun. The prompt requests discovery, but it is not a mechanical requirement.

**Why it matters:** The same code path that promises event protection can be bypassed unintentionally by a model that starts mapping cuts first.

**Fix:** Version the workflow or add a `discoveryRequired` flag for new plans; require complete indexed scope before any destructive plan can apply. Keep a clearly isolated legacy compatibility route for old saved plans instead of using `array.length === 0` as an opt-out. Expose `unscannedDiscoveryRanges` from the start.

**Regression test:** A fresh construction with comprehensive overview receipts, beats and cut edges but no discovery scans must refuse `apply_video_construction`. Old saved plans may be migrated explicitly.

### P0-B — Candidate discovery silently truncates events

**Code:** `src/editor/construction-event-index.ts:80-82` selects at most **20** visual-change peaks, `:96-99` selects at most **50** boundaries, and `:106-114` truncates the aggregate to **140** events. The results and saved scan in `src/integrations/tools/video-construction.ts:156-173` have no `truncated`, `candidateCountBeforeLimit`, or unprocessed-range indicator.

**Why it matters:** A busy minute can have late events excluded while the entire minute is marked scanned. A visually important but lower-energy change can also be excluded by the top-20 ranking. No later review can recover an event the index omitted.

**Fix:** Paginate candidates or persist every trigger with a bounded storage/job policy. If any cap is reached, mark the scan `incomplete`, include the discarded count/time range and require a finer rescan before cuts can be approved. Use balanced temporal coverage rather than top-N by signal magnitude alone.

**Regression test:** Inject 200 meaningful signal positions across a minute and verify that no portion of the interval can be marked fully discovered until overflow is handled; include an important low-score visual event.

### P0-C — Sparse overviews can satisfy a discard decision

**Code:** `src/integrations/tools/video-construction.ts:105-129` saves `inspect_video_range` receipts spanning up to **60 seconds** with only **12** stills. `:229-231` and `:256-259` allow `review_discovered_events` / `review_discovered_event` to accept any single `audio:true` receipt covering the event, even when it is that sparse overview. `src/editor/video-construction.ts:139-143` also treats receipt range coverage as audiovisual evidence. The `audio:true` flag means audio **metrics** ran, not that a model heard and understood it.

**Why it matters:** A 1-second silent setup inside a longer window can be discarded despite never appearing in the 12 sampled frames. Covering timestamps is not the same as observing the relevant moment.

**Fix:** Add inspection evidence quality and modality explicitly: `sampledOverview`, `denseVisual`, `audioMeasured`, `speechTranscript`, `audioPerceived` with provenance. Keep the original sampled receipts as triage only. To mark a candidate `discard`, require direct local visual sampling at its actual trigger frames and sufficiently dense source/action frames; require semantic audio when the reason depends on tone, laughter or game audio. For each proposed deletion, require the retained lead-in/lead-out and excluded contents to have been adequately checked.

**Regression test:** Place a critical silent one-second action between the 12 overview sample times. Attempt to discard using overview only and assert rejection; after dense event inspection, model can choose keep/uncertain on actual evidence.

### P0-D — No reversible, exact source provenance for the assembled video

**Code:** `src/integrations/tools/video-construction.ts:163-169` records `sourceClipIds` using overlapping **clip IDs**, not exact source asset ID, in-point/out-point, speed mapping, nested sequence identity or visible/audible precedence. `apply_video_construction` (`:359-377`) uses only `timeline.removeRange` to shorten the live timeline. `begin_construction_repair` (`:412-429`) restarts from the *shortened* timeline.

**Why it matters:** A necessary setup cut away during the first attempt cannot automatically be restored; the reviewer cannot reliably trace output frames to the originally authorised time ranges, especially for overlays, nested sequences, speed ramps or detached audio.

**Fix:** Snapshot an immutable permitted-source manifest at construction start: timeline track/clip IDs, exact original frame span, asset/sequence identity, source-time mapping, audio/visual routing and media fingerprint. Build a non-destructive edit decision list of selected spans and output order, with an output-frame-to-original-source mapping. Make repair rebuild from this manifest, not from the edited output.

**Regression test:** First pass accidentally deletes the only setup; a failing reviewer restores exactly that originally authorised source span in pass two, without accessing any non-timeline asset. Include nested, speed-ramped and detached-audio cases.

## High-impact production-quality gaps

### P1-E — There is no explicit narrative specification or required-arc checker

**Code:** `src/editor/video-construction.ts:15-21` holds generic beats (chapter, scene, setup, payoff, reaction, callback, continuity), but no required story section, minimum setup anchor, round/night sequence, ending, significance, selected-order constraint, narrative duration budget or coverage of unresolved questions. `review_video_construction` (`src/integrations/tools/video-construction.ts:433-463`) checks mostly model-provided `story` / `pacing` strings and `issues: []`.

**Fix:** Formalize a `NarrativeBrief` (premise, audience knowledge, challenge rules, editor tone, target length, must-have continuity, desired opening/end), a `MomentInventory` (timestamped events and reliable evidence), and `StoryOutline` (cold open, rules, rounds/nights, escalations, callbacks, resolution). Require an explicit mapping from every must-have beat to output frames; report missing/duplicated/out-of-order events.

**Acceptance:** A viewer who has never seen the stream can identify the rules, what changed in each night, why a joke pays off, and how the video ends; the editor preserves a deadpan pause when it is part of the humour.

### P1-F — Real voice and gameplay-sound meaning remains weakly grounded

**Code:** `src/editor/smart.ts:93-112` supplies phrase-level source transcripts. `src/editor/construction-context.ts:85-122` blocks only phrase-intersecting edges. `src/integrations/tools/video-construction.ts:269-325` sends up to 12 seconds of WAV to an audio-capable model, but `record_construction_audio_observation` requires only a stored sample ID, not proof of provider consumption; a failed unsupported-model transport may still leave a captured sample receipt. Audio energy changes in the index cannot tell gameplay, reactions, jokes, music or shouting apart.

**Fix:** Use word-level alignments where available; add diarization and voice/game/music stream separation when source stems exist; create a grounded audiovisual interpretation with exact timestamp, speaker, acoustic cues, visual state and uncertainty. Introduce a provider-delivery receipt before promoting model-reported audio interpretation to verified listening. Require listening for decisions that depend on vocal delivery, laughter, silence and game-sound meaning; never infer those from PCM metrics.

**Acceptance:** Held-out indistinguishable-volume samples (normal speech vs. sarcastic line, laughter vs. game scream, music crescendo vs. gameplay danger) must not receive the same event interpretation merely from energy or text.

### P1-G — No pre-apply A/B join audition, and music tracks are not handled intentionally

**Code:** `apply_video_construction` calls `timeline.removeRange` with no `keepWhole` set. `src/editor/ops.ts:401-462` trims/ripples all unlocked tracks by default. `inspect_construction_join_audio` (`src/integrations/tools/video-construction.ts:381-409`) measures about 0.5 s on either side of a join **after** the edit; waveform jumps and RMS shifts are not proof of speech, emotional or musical continuity.

**Fix:** Render short pre-apply A/B join previews from the actual timeline mix with source handles; measure word/phoneme tail risk, transient continuity, visual motion phase and audio transitions. Set explicit policy for voice/dialogue, game SFX, music beds, ambient beds and detached sound, preserving continuous beds with `keepWhole` or remixed audio when appropriate. Add an audible post-apply reviewer judgment for flagged joints.

**Acceptance:** Fast-paced cuts do not interrupt syllables or music unnaturally, swallow a laugh, or hard-cut through the critical game sound at a story payoff.

### P1-H — No genuinely independent semantic quality critic

**Code:** `src/editor/video-quality.ts:49-82` finds structural defects such as invalid timings, missing assets and overlaps, not missing challenge rules, misplaced callbacks, under-explained gameplay, slow pacing or an incoherent ending. `constructionStatus` (`src/editor/video-construction.ts:205-216`) marks complete when submitted review has no issues and covers join IDs. The same editing agent may assert success with prose.

**Fix:** Review a newly rendered output independently of the editing plan; compare required original events against actual output source-map, challenge/night order and audible dialogue. Use a critic with separate prompts/evidence or a separate model/human assessment for subjective humour and watchability; score clarity, pacing, continuity, audio, visual coherence, personality retention and accuracy with linked timestamps. Make `complete` require objective invariants and unresolved-risk acknowledgements, not just an empty issue list.

**Acceptance:** A structurally valid output with a missing rule explanation, an orphaned punchline or swapped round outcomes must fail.

### P1-I — Long-form discovery is not cost-effective yet

**Code:** `scan_construction_events` performs one call per ≤60-second chunk, sampling ≈2 images/s and rendering audio for that chunk. A four-hour input means at least **240 scan calls**, plus event review, cut contexts, dense picture inspection and output verification. The Copilot continuation is bounded to an initial 24-step model run plus at most 12 follow-on batches of 24 steps; this cannot reliably scale with per-candidate and per-cut reasoning for many hours.

**Fix:** Implement a local indexed worker that iterates the entire authorised source manifest in bounded resumable chunks, stores compact signals and captions, and pages high-priority candidate windows to the agent. Separate compute scanning from expensive model semantics. Track time-coverage, worker checkpoints and content revisions, not just record counts. Add explicit cost/compute budgets and controlled backpressure.

**Acceptance:** A 4-hour timeline is indexed using one job orchestration call plus progress/status queries; interruption/relaunch resumes exact scan progress. No need for one model call per minute.

## Additional observed weaknesses

- `src/editor/video-construction.ts:188-194`: **over-broad dependency protection** — a cut anywhere inside a setup beat can be rejected whenever another retained beat depends on it, even if the cut is only redundant walking. Protect exact sub-beat evidence anchors instead.
- `src/editor/video-construction.ts:104-109`: coverage is based on ranges declared in submitted inspection notes, not independently verified continuous observation; distinguish coarse from scene-verified coverage.
- `src/editor/video-construction.ts:85-90`: the initial permitted scope uses spans from every timeline clip, including auxiliary layers, rather than a per-output audiovisual source manifest. Do not mistake merely overlapping assets for footage actually displayed or audible.
- `src/integrations/tools/video-construction.ts:368-377`: edits are committed to the editor, then construction metadata is persisted separately. A save failure can leave an applied edit with ambiguous durable state. Add recovery checkpoints and fault injection.
- Source-grounded semantic video creation currently does not systematically check game-state facts, character locations, deaths and respawns, inventory/challenge rules, night starts/ends or timeline-continuity consistency. Web research should suggest *what to verify*, never count as evidence that it occurred in the recorded media.

## Recommended implementation order

1. **Accuracy hardening (first):** compulsory index for new runs, non-truncating/paginated signal inventory with incomplete-state propagation, and dense evidence required before event discard or deletion. These are high-impact correctness fixes without waiting for sophisticated AI.
2. **Keep-first source manifest + output EDL:** non-destructive construction, source mapping, intentional order, hook/round/ending arc and automatic restoration.
3. **Semantic audiovisual candidate understanding:** transcript alignment, sound class, real listening receipts, game-event grounding, source and output identities, risk-driven dense visual sampling.
4. **Cut quality engine:** preview A/B candidate joins, audio class policies and word-safe boundaries, audio crossfades with intentional sound design.
5. **Independent objective + subjective output critic:** compare actual assembled output against outline and required source moments; reconstruct faulty sections from original manifest.
6. **Long-form worker/index:** resumable whole-recording processing with model-cost budgeting and compact event/context pages.

## Verification plan for editing accuracy

Create a private, held-out **multi-round gaming fixture** with labeled true events and adversarial decoys:

- A necessary silent visual clue between overview-sample timestamps.
- A 200 ms visual game indicator with no scene-cut spike.
- An important in-game event with ordinary loudness and an irrelevant sudden loud noise.
- A spoken joke with a callback 15 minutes later and a deadpan pause that should stay.
- A rule explanation, each night start and result, and an ending.
- Speech starting/ending near a proposed edit edge, incorrect transcription and detached game audio.
- Music spanning two candidate edits and a deliberate sound-design impact.
- A first-pass missing setup that must be reintroduced during repair.
- Another imported asset that is not present on the initial timeline and must never appear in the output.

Track **event recall**, false-positive detections, critical-moment retention, missed setup/payoffs, narrative-order errors, cut-boundary defects, audible failures, unauthorized source usage, recovery success, model calls, output duration and human-assessed watchability separately. Only raise the product's completion claim once real-footage evaluation validates them.

---

**Status:** No implementation is implied by this review. Windows CI verifies that the checked-in system builds and its current regression tests pass; those tests do not show that the generated videos meet creative or semantic quality targets.

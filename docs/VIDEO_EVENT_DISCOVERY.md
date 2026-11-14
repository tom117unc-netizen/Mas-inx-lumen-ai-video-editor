# Construction event discovery (first implementation)

This milestone adds a **timed event-candidate index** to the persistent, timeline-only construction workflow. It is a high-recall search aid, not a completed AI editor or recognition of what a gameplay event *means*.

## How to use

1. Start an edit with `begin_video_construction`. The footage to use must already be on the open timeline. **New plans must complete discovery before applying any deletion.** Previously saved plans that predate the discovery requirement remain readable under their legacy rules.
2. Read `missing_timeline_transcripts` from `get_video_construction`, and transcribe any audible source assets listed there using `transcribe_media` before scanning; a new scan refuses untranscribed likely speech sources. A *completed* transcription containing zero detected words (`transcript: []`) counts as analysed, not perpetually missing; it does not prove the audio is silent or unimportant. Use `scan_construction_events` to cover each original permitted range in **non-overlapping windows of at most 60 seconds**. Read `get_video_construction` after each scan to see `discoveryScans`, `discoveryEvents` and the next `status.uncovered` range when discovery remains unfinished. A repeated request for the exact same range reuses the existing scan.
3. Use `get_discovery_queue` to inspect the most consequential *unresolved* candidates first, particularly those overlapping a proposed removal. Its ranking reflects uncertainty and edit risk, **not narrative value**. `review_discovered_events` can commit up to 20 individually inspected decisions atomically; one missing receipt rejects the entire batch.
4. The tool renders low-resolution pictures of the actual timeline at roughly **two samples per second**, a bounded 8 kHz timeline audio mix, and synchronizes existing transcript phrases and clip boundaries. It identifies **candidate** speech stretches, unusually large visual changes, audio level rises/drops and clip transitions. It does not identify a game, objective, funny joke, death, laughter or night ending by itself.
5. For candidate moments likely to affect an edit, call `inspect_video_range` around the event (and `inspect_construction_audio` with a compatible model when listening is necessary). **Discarding an event requires focused visual evidence:** use `mode: focused` for up to 3 seconds at a time, set `priority_frames` to the event's exact visual trigger frames inside that range, and concatenate consecutive focused inspections for longer events. `boundary` mode inspects all frames in 12-frame windows. Ordinary 12-frame/60-second `overview` evidence can justify keeping or flagging uncertainty, but **never discarding** a detected event. Then call `review_discovered_event` using the relevant receipt IDs, a reason and one decision:
   - `keep`: protected from planned removal.
   - `discard`: may be removed if all the existing story, speech-boundary and cut-context gates also pass.
   - `uncertain`: cannot be removed until the uncertainty is resolved.
6. Build story beats, protected reactions/setups, and cuts as before. For **all new construction plans**, applying cuts requires complete discovery coverage of the original timeline, even if the agent tried to skip scanning. Legacy plans that lack the new flag retain previous rules. A cut crossing any pending, uncertain or protected candidate is rejected; a candidate discarded after review can be considered for removal.
7. Complete the existing full output and join-audio review. The indexed event inventory remains saved in the .lumen project and can be paginated after a restart.

## Evidence provenance

Each saved scan records its original timeline range, fingerprint, exact sampled frames, audio-measurement availability and number of transcript lines. Discovery no longer drops events from a silently truncated top-N list: when a bounded scan has too many candidates, the scan fails without marking that range covered and instructs the agent to split it. Revisions increment even when decisions or story content change but item counts stay constant. Each candidate carries a scan ID, range, signal type, measured strength, sampled visual frames, transcript clip IDs and overlapping source clip IDs. Editor judgement is separate from the measured signal, with a decision reason and real inspection IDs.

A visual frame jump can be ordinary UI motion. A sudden sound can be speech, game audio or music. A quiet gap can still contain a vital silent visual setup. **The complete intervals between sampled pictures have not been watched**, and the system cannot guarantee discovery of every significant event. Treat the index as an investigation priority map, not a final edit recommendation.

## Known limitations and next engineering stages

- This is the first **60-second chunk** scanner, not yet a scalable multi-hour worker/background job. Repeated tool calls are still needed to cover hours.
- Semantic event recognition still requires genuinely capable audiovisual reasoning and focused follow-up inspection; numeric scores and transcription are not sufficient.
- Audio level changes are measured without isolated source stems, so they cannot assign the sound to a speaker or game.
- The existing removal engine remains *delete-first* and cannot rearrange selected story beats or restore deleted source. Implement the immutable original-timeline source manifest and keep-first EDL as the next milestone.
- New plans mechanically require discovery; older saved plans lacking the `discoveryRequired` flag keep their legacy rules. A missing/failed transcript still requires correction or explicit manual handling before a new scan; model confidence is not a substitute for transcript data.

## Test strategy

Unit tests cover detection of spikes and drops, data provenance, boundary clipping, transcript grouping, and the absence of invented semantic labels. Integration tests cover scan progress, partial coverage, repeat/double scan behavior, project save/reload, refusal to discard without real inspection, and blocking cuts through unresolved/protected events.

**Additional acceptance needed:** On held-out footage, test a brief visual-only cue deliberately placed between sampled frames, a genuinely funny speech-delivery moment, a music/game-audio false positive and a multi-night boundary. The event index should guide focused inspections, never automatically certify those samples as unimportant.

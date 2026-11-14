# Contextual video construction

This upgrade adds a persistent editorial workflow to the existing Lumen Copilot. It is available to the built-in cloud model and through the editor's registered tools to local agents/MCP clients. Cloud-model runs can continue in bounded batches; external agents manage their own execution loops.

## Use

1. Put the footage you permit Lumen to use on the current timeline, and save the project.
2. Ask the Copilot to construct a complete video. Include the premise, intended audience, approximate length and any essential moments. For example: “Turn this stream into a coherent 20-minute video. Establish the challenge, preserve each night's beginning and outcome, keep complete jokes and reactions, and tighten repetition inside scenes. Use only the footage already on the timeline.”
3. The Copilot first obtains available transcripts and indexes candidate events in non-overlapping 60-second-or-shorter windows; no new plan may apply deletions before index coverage is complete. It then investigates the timeline, records audiovisual coverage and a hierarchy of chapters/scenes/beats, protects essential moments and dependencies, and proposes exact frame ranges to remove.
4. For every proposed cut, call `inspect_cut_context` after the story links and frame range are set. It retrieves the containing scene, earlier dependencies and later linked callbacks, nearby beats, transcript immediately before/inside/after the proposed deletion, and possible distant transcript matches on the current timeline. Investigate all relevant leads audiovisually; lexical matches are not proof of a real callback. The saved context-read receipt becomes stale if the story map or cut is revised.
5. Boundary inspection returns every frame in a small window as separate images. Application requires coverage, fresh scene-context retrieval and adjacent-frame evidence; it rejects cuts through available transcribed phrases, validates dependencies, and applies all proposed removals in one undo step.
6. After application, the output must be inspected again: new joins plus sampled coverage of the whole edit. For each created join, call `inspect_construction_join_audio`, which measures an actual rendered audio mix near the join. It flags possible sample discontinuities or abrupt level shifts; it cannot listen semantically.
7. Complete `review_video_construction` with a reasoned `join_verdicts` entry for each flagged audio join (`accept` if the cut is intentionally abrupt and the actual context supports it; `repair` if defective). Any repair verdict becomes an unresolved issue.
8. If a review reports issues, `begin_construction_repair` starts a fresh pass on the current, shortened timeline, retaining failing join positions and feedback. It does not silently re-import discarded footage. There is a maximum of three repair passes; unresolved issues must be reported rather than looped indefinitely.

Ask for status to inspect progress without authorizing more edits. Ask to resume to continue. Ask to pause construction to release the AI editing safeguards without discarding the map. Manual timeline edits remain available; changed timing or media identity makes the old plan stale and requires re-mapping. Undo/redo of edits is supported, but construction metadata is retained separately and can become stale.

## Tools and state

- `begin_video_construction`, `get_video_construction`, `resume_video_construction`, `pause_video_construction`
- `scan_construction_events`: index the current authorised timeline only, after transcribing untranscribed audible assets; record potential speech, sound-level, visual-change and clip-boundary events. Candidate lists are not silently truncated; overfull scans must be split.
- `get_discovery_queue`: prioritize unresolved candidates most likely to be affected by proposed cuts; signal rankings are NOT semantic significance.
- `review_discovered_event` and `review_discovered_events`: save up to 20 event decisions per batch. A discard requires covering direct focused/boundary visual inspection including exact visual trigger frames; a sparse overview receipt is insufficient. Decisions and their evidence are stored in the project.
- `inspect_video_range`: overview up to 60 seconds / 12 sampled frames; focused up to 3 seconds / 24 evenly sampled frames plus up to 8 exact requested trigger frames; boundary up to 12 consecutive frames. The samples are separate images at 1280px by default, up to 1920px.
- `update_video_construction`: upsert coverage, hierarchical beats, essential dependencies, protected intervals and proposed removals. All times are half-open integer timeline-frame ranges.
- `inspect_cut_context`: return linked and nearby story context, timeline dialogue around a removal and bounded lexical clues to potential distant callbacks. Records a fresh retrieval receipt, not a quality approval. Transcript phrase boundaries that intersect a cut prevent a receipt.
- `next_event_probe`: midpoint refinement only for a single bracketed change; not a detector and not appropriate for repeated disappearances.
- `apply_video_construction`: validate or apply the proposed removals atomically.
- `inspect_construction_audio`: render up to 12 seconds from the current timeline to a bounded 24 kHz WAV. Gemini-equipped Copilot models can receive that WAV in the next model step and analyse delivery, laughter and game/audio events; unsupported text-only models fail with a clear explanation. Each request sends only its chosen timeline window to the selected model service and stores a source-range receipt, not raw audio in the project.
- `record_construction_audio_observation`: persist a cautious, confidence-labelled account of audible cues linked to an authentic captured sample ID. This is a model assertion, never automatic proof that it interpreted the clip correctly.
- `inspect_construction_join_audio`: render and measure a bounded audio window centred on an actual edited join. Save a fingerprinted receipt, waveform discontinuity and level-shift metrics, and nearby transcript lines.
- `review_video_construction`: require output inspection, new-join frame checks, an audio measurement receipt for every join, explicit verdicts for flagged audio joins, and story/pacing findings before completion.
- `begin_construction_repair`: begin a new plan only after an applied construction review has unresolved issues; retain the failed joins/reasons for the next pass and cap repair depth at three.

The compact plan and inspection receipts are stored in the `.lumen` project and explicitly saved after updates. Detailed source transcripts/research remain available in the existing Context Bank. Overview coverage means sampled inspection, not that every frame was observed. A receipt proves that inspection tools ran; interpretation and editorial judgement still belong to the model.

## Limits and acceptance testing

Speech-boundary validation blocks a cut through any available timed transcript phrase, including when a transcript arrives after context inspection; absent or incorrect transcripts cannot be interpreted as safe silence. Audio evidence currently consists of transcript, measured audio properties and short rendered-mix join analysis. Possible click/level-shift flags are useful warnings, not proof that a transition was bad. An explicit verdict can accept an intentionally hard cut with stated reasons; this remains a model judgement, not actual listening. Numerical-only tools do not supply semantic listening to laughter, sarcasm, delivery or game sounds. The optional Gemini audio route supplies actual sampled sound to a capable model, but model judgements can still be wrong and must be checked against the video and editor context. Uncertainty must remain explicit. Bisection does not discover an event until actual frame observations bracket it. The first construction operation is chronological removal/tightening, not automatic scene rearrangement or a new effects system.

Cloud runs allow up to twelve additional 24-step batches, recognize the durable construction revision as progress even when beat/event counts stay constant, stop when the recorded progress stops changing, and report unfinished work rather than equating a budget limit with completion. A saved plan can be resumed. Use the installed provider's normal usage/cost controls.

Gemini audio support depends on the selected model and provider account: do not assume an arbitrary OpenAI, local, or compatible model accepts WAV input. A selected Gemini model is the only presently enabled Copilot audio transport. The AI SDK routes the attached sample to that model, and audio is excluded from persisted Copilot chat history.

Before trusting a long stream edit, run a short real-footage trial containing a silent visual setup, a joke with a delayed payoff, a callback to an earlier scene, and speech at both sides of a proposed cut. Check actual listening quality (including clear clicks, game sound and music continuity), source/timeline correspondence, synchronization, natural delivery, targeted repairs, undo, save/reopen and export in the Windows build. Unit tests and a successful production build do not establish these perceptual outcomes.

## Build on Windows

Use branch `feature/contextual-video-construction`, application directory `Lumen-Fixed`, and Node 24. Run `npm ci`, `npm test`, `npm run build`, then `npm run dist`. The existing CI supplies the missing-upstream-icon fallback and packages the Windows installer as a workflow artifact. The base application still reports version 1.4.0; identify this experimental build by its branch/commit. No installer is published as an upstream release by this change.

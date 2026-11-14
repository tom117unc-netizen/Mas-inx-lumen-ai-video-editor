# One-call local source indexing and evidence-backed event interpretation

Updated 14 November 2026. Implements the two remaining front-end stages of the Lumen construction workflow without introducing a new media database, trained model or a separate agent swarm.

## What happens now

1. The user provides and saves **only the footage permitted on the current timeline**. `begin_video_construction` freezes original source/track identities and the source fingerprint.
2. Lumen transcribes audible original assets lacking transcripts. Missing transcripts are explicit blockers; low signal amplitude is not evidence of silence.
3. Lumen calls **`start_construction_indexing` once**. A LOCAL renderer-side job scans authorised original source footage, yielding between chunks. Each chunk uses the existing validated `scan_construction_events` implementation: about two pictures per second, audio waveform changes, transcript timings and clip boundaries. It stores exact non-overlapping original frame ranges and candidate signals after every chunk. A dense chunk with excessive triggers is retried as smaller non-overlapping chunks, not silently truncated.
4. `get_construction_indexing` exposes completed original frame coverage, outstanding ranges, the candidate count and running/paused/failed state; `pause_construction_indexing` requests cancellation at the next safe chunk boundary. After restart or failure, the in-memory job no longer exists but the saved scan coverage does: starting again scans only the unindexed ranges.
5. While indexing runs, the existing Copilot chain checks progress **without making AI provider requests**. When the job completes, the Copilot resumes the context-bank and editing stages. An explicit cancellation also asks the local worker to pause. There is no provider timeout imposed on the local scanner's internal progress; the app must remain open.
6. The whole-footage Context Bank still records source ground truth clues and working narrative summaries. The editor inspects events with `inspect_video_range`, and where audio meaning matters uses `inspect_construction_audio` with a model actually capable of receiving WAV samples.
7. `get_event_investigation_queue` returns the highest-priority remaining discovery candidates in small batches. `record_construction_event_findings` logs **what the actual source showed**, a bounded observation, uncertainty and original receipt IDs. It prevents a sparse overview from certifying gameplay semantics, checks exact sampled trigger frames, and demands an appropriately covering recorded listening observation before labelling confident laughter, music or game sound. Purely visual jokes or reactions may be grounded in inspected source frames without a fabricated audio claim. Changes invalidate earlier local story-context certifications.
8. Essential verified events are promoted separately to `record_construction_narrative_moments`; keep-first assembly preserves required story dependencies and source frames. A mere waveform spike, frame difference or web-search result never automatically becomes an essential game event.

## Efficiency and safety

- The scanner is a **renderer-local asynchronous job**, not a parallel system worker thread. It yields to UI/event handling between media chunks; frame decoding and audio rendering may still cause temporary CPU load. A dedicated worker thread would be justified only if performance measurements show the need.
- Per-media indexing is **bounded at 60 seconds per chunk** and may shrink to denser windows automatically. It does not keep a remote AI request open, and source scan coverage—not the in-memory job counter—is the durable checkpoint.
- The local job cannot import new assets, process ranges outside the authorised timeline, or continue indexing a fingerprint that changed. It stops visibly on unexpected media/renderer errors and never labels unscanned footage as covered.
- Candidate semantics are model-reported findings tied to real inspection receipts. A recorded audio-observation ID confirms a relevant sample and observation exist, **not cryptographic proof that the provider consumed the WAV or interpreted it correctly**.
- The model's overall video-construction batch limit remains finite. An app crash after a persisted local index chunk leaves that work recoverable, but the **cloud editing agent does not silently restart itself after the application exits**.

## Relevant code

- `Lumen-Fixed/src/integrations/tools/construction-index-worker.ts`: asynchronous job controller, exact saved progress, cancellation, density-adjusted work selection
- `Lumen-Fixed/src/integrations/tools/video-construction.ts`: start/progress/pause entry points; uses existing source scanner unchanged; candidate interpretation/inspection tools
- `Lumen-Fixed/src/editor/construction-event-findings.ts`: pure event interpretation evidence gates and compact investigation priorities
- `Lumen-Fixed/electron/integrations/ai/agent.ts`: wait for local indexing without cloud provider calls, resume model work when indexing completes
- `Lumen-Fixed/electron/integrations/ai/construction-task-chain.ts`: transcribe then start one local indexing job, and investigate semantics in focused micro-tasks

Automated regression tests exercise exact source gaps, pause/resume, interrupted/error checkpoints, high-priority interpretation queue, focused image trigger verification, uncertainty, auditory evidence requirements, and no provider polling during active local indexing.

## Still required to validate real output quality

Use a representative multi-hour local video with voice, gameplay and music, deliberate silent action, ordinary-volume important events, loud irrelevant sounds, delayed jokes, multiple round boundaries, and challenging speech joins. Confirm actual event recall and transcription accuracy, not merely presence of candidate signals. Run an independent viewer/reviewer on the assembled output and improve join auditions/corrections based on real failures. Windows CI proves the code builds and unit contracts hold, not that the system understands every scene.

# Audio-aware construction: real-footage acceptance

The unit tests prove that a bounded WAV is captured, sent through the editor/agent bridge, and attached to a selected Gemini model step. They do **not** prove that the selected model correctly understands audio. Do not mark this feature production-ready without the following Windows trial.

## Trial material

Use a saved .lumen project containing only permitted gameplay footage on the active timeline. Make a 2–5 minute representative excerpt with explicit timecodes for all of these:

- Ordinary spoken setup, punchline, delayed laughter, and a later spoken callback
- A silent visual anticipation that must not be deleted because it lacks speech
- Two different game sounds (e.g. a hit and a menu effect), at least one under speech
- Background music and a deliberately sharp sound transition
- Speech that begins before, or continues after, a potential cut boundary
- A false positive: a loud noise that is *not* laughter or a reaction

Keep the reference labels (time ranges, observed event, whether a cut is safe, and the intended progression) outside the model prompt. Do not use an AI-generated transcript as the ground truth for acoustic details.

## Reproducible run

1. Save the project; check that all source media is on the current timeline. Create a new construction pass with a clear goal, including each night's opening and outcome if applicable.
2. With a supported Gemini audio-understanding model selected in Copilot, call `inspect_construction_audio` for focused windows of at most 12 seconds. Check that tool result includes an authentic WAV (RIFF/WAVE), correct requested frame span, and a receipt ID. Read the attached audio, not just transcript text.
3. Record interpretations via `record_construction_audio_observation` using event type, concrete audible cues, confidence, and uncertainty. Compare each against the held-out reference labels. Record false alarms, missed cues, and uncertain cases; do not turn ambiguous evidence into invented facts.
4. Repeat a short test on a non-audio model. It must say that it cannot receive/listen to WAV evidence; it must not report that it heard laughter or delivery.
5. Build the story map. Inspect every proposed cut's context and adjacent frames. Cuts through transcribed phrases must be rejected. Confirm that nonverbal anticipation, jokes and later callbacks remain intact.
6. Apply one small cut set, inspect output video joins and their rendered PCM measurements. Flagged audio discontinuities need reasoned accept/repair verdicts. Check actual playback with headphones for audio that was not caught numerically.
7. Deliberately flag a bad join in review. Verify `begin_construction_repair` carries the failed join position, re-maps only the CURRENT shorter timeline, never silently re-imports discarded footage, and stops after three repair attempts.
8. Undo, save, close, reopen, and export. Confirm recorded sample IDs/observations survive save/reopen, stale samples cannot be reused after a timeline change, the final export is synchronized and no new media was imported.

## Pass / fail criteria

- **Sound recognition:** The model's stated audible cues match what a human actually hears; count misses and false positives separately for laughter, game sounds, music and speaking delivery. An unrecognized or ambiguous sound is labelled uncertain, not asserted.
- **Timeline fidelity:** Each inspected WAV is the exact requested output mix and interval, and only the current timeline is involved.
- **Narrative:** A new viewer can follow the initial challenge, each round/night start and end, cause and effect, joke setups and eventual callbacks. Reviewers must inspect actual footage, not just transcripts or static thumbnails.
- **Audio continuity:** No clipped syllables, unintended clicks, masked voices or destroyed intentional anticipation at edited joins.
- **Safety and persistence:** One-step undo, explicit status, bounded continuation, stale-state rejection and no unauthorized source re-use remain intact.
- **Provider behavior:** A supported Gemini model is required for automatic audio comprehension. Unsupported model paths fail visibly and never claim success.

Keep a trial log with the branch/commit, build artifact, source fixture details (no private media content), timecodes, model ID, audio transport result, expected/observed events, editor findings, export result, and any unresolved limitations. Unit tests alone cannot pass this acceptance gate.

# Source-preserving story assembly and targeted repairs

**Implemented on** `feature/contextual-video-construction`, 14 November 2026. This is the first genuine *constructive* video pathway in Lumen: it assembles selected original source footage into a new editable sequence instead of shortening/destroying the recording on its existing timeline.

## Original source snapshot

`begin_video_construction` freezes a source manifest for the **currently authorised timeline only**. The manifest holds exact original clip properties, track routing, source in-points, ramps/speed, animations and timing; track identities, markers, project settings, source sequence ID and a source fingerprint. It is persisted with the construction project, not reconstructed from the final shortened edit.

The original source sequence is never overwritten by `publish_keep_first_assembly`. Publishing switches the editor to a **new output sequence**, storing the original alongside it. This is an atomic command, so undo reverses the entire publish.

## Edit decision list (keep-first)

After the duration-aware whole-video context bank and local section analysis are completed, Lumen proposes a compact ordered **list of selected source spans** with:

- Stable selection ID and integer source-timeline start/end frames
- Explicit output order, grounded story-beat ID and role (`hook`, `setup`, `scene`, `escalation`, `payoff`, `callback`, `ending`, `complete`)
- Reason for retention and actual audiovisual inspection receipt IDs

The model can save revisions in small batches with `record_keep_first_selections`; no single provider call needs to decide every clip in a four-hour recording.

`preview_keep_first_assembly` checks the entire EDL *before publishing*: original scope and project identity, full event discovery, banked context, actual local editing plans, complete audiovisual inspection evidence, exact adjacent frames at every prospective edit edge, timed dialogue phrases crossing selection edges, protected source moments, unresolved/keep candidate retention, and essential setup dependencies appearing before their payoffs. A future source event that has not been reviewed as discard cannot simply disappear into an omitted span.

The validation is intentionally conservative: it may require more inspection and clarification rather than silently losing an important reaction.

## Frame-accurate multi-track output

The assembler uses the editor's existing `splitClip` timing implementation to trim exact subranges, rather than calculating new source in-points by naive multiplication. The resulting sequence preserves every eligible original overlapping track—video, voice, overlays, effects, music, titles and markers—while remapping clip/group/track IDs to avoid collisions.

Its persistent source map records each output clip's actual output frame range and in-point, **which original clip/track/asset it came from**, and its exact original timeline frame range. Source clips that overlap multiple output sections are copied separately. A selected intro can be a later source moment, followed by an earlier explanation, provided declared story dependencies remain valid.

A magnetic main track is retained only when its source clips cover every retained section; otherwise the output track drops magnetic packing so that legitimate silent/overlay gaps cannot shift audio out of sync.

## Actual output inspection and repair

`publish_keep_first_assembly` opens the new sequence and sets the construction to **review-required**, not completed. The agent inspects the output's actual visuals, rendered audio around every new join, and overall story progression.

`audit_assembled_source_map` is an independent deterministic output check of the *actual open output*: it verifies original source is still present, source identities and media routing, exact clip/section timing, the source-to-output map, any extra untracked output clips, and final duration. `review_video_construction` includes audit problems among its required repair issues. This is **objective provenance checking**, not a substitute for a real semantic viewer/critic.

After a review records real issues, `reopen_construction_source_for_repair` performs one undoable action: save the unsuccessful output as its own sequence; switch to the **unchanged original source sequence**; restore the original inspection evidence, bank and story map; and allow source selections to be adjusted and republished. Previous versions remain in the project. Repair attempts remain bounded. If the original source sequence was modified, recovery stops rather than misleadingly trusting stale source findings.

## Current limitations

- This preserves exact timeline source identity and clip effects as represented in the editor, but **semantic quality remains model-judged**; game-state detection, sarcasm, laughter, comedy timing and true watchability require independent audio-visual criticism and real-footage benchmarks.
- Phrase-level transcription prevents obvious dialogue cuts; it does not prove that untranscribed speech, laughter or phonemes are safe. Targeted listening remains essential.
- The preserved source manifest increases project metadata size in exchange for repeatable source repair; exceptionally huge projects need a future disk-backed indexed manifest.
- Independent human evaluation and induced-timeout real-provider tests are still needed. Unit tests and successful Windows packaging do **not** establish a finished-video-quality guarantee.
- The legacy `apply_video_construction` deletion command remains available for deliberate existing workflows, but **new autonomous whole-video work should prefer the keep-first publish route**.

## Relevant implementation

- `Lumen-Fixed/src/editor/construction-assembler.ts` — immutable manifest, ordered source EDL, exact trimming, provenance and output audit
- `Lumen-Fixed/src/editor/video-construction.ts` — persisted source manifest, selected scenes, publish/repair state, original evidence
- `Lumen-Fixed/src/editor/commands.ts` — one-undo atomic publish and original-source restore
- `Lumen-Fixed/src/integrations/tools/video-construction.ts` — staged selection, preview, publish, audit and repair tools
- `Lumen-Fixed/electron/integrations/ai/construction-task-chain.ts` — small Director work units across model calls

Tests cover original timeline preservation, reordering, exact clip and group routing, protected moments, omitted unresolved discoveries, actual source maps, deterministic audit corruption detection, source-backed repair, multi-version preservation and undo.

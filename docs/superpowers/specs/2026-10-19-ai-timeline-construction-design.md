# AI Timeline Construction Design

## Goal

Give Lumen a general, approval-safe way for AI features to construct timeline material, beginning with materialised PNGTuber mouth sync and then reusing the same primitive for anime-review footage assembly.

## Intent and success criteria

Lumen should turn existing analysis/plans into real editable timeline clips without bypassing review. The first consumer is narration-driven PNGTuber mouth sync: given an existing narration clip, explicit open/closed sprite assets, and a target video track, Lumen creates frame-exact sprite clips covering the narration placement. The same timeline-construction mechanism should later support source-footage placement for review beats.

Success means:
- AI can propose adding and removing clips, not only mutate existing clips.
- proposals remain non-mutating until approved;
- approval rejects stale projects using the existing project fingerprint;
- applying an approved proposal remains one undoable editor commit;
- generated mouth clips exactly cover the mouth-sync intervals and preserve a deliberate avatar layout;
- no sprite filenames are guessed: asset IDs are explicit;
- locked tracks, unknown assets/tracks, malformed clips, duplicate clip IDs and excessive edit counts are rejected;
- proposal previews can represent clip creation and deletion rather than assuming every edited clip exists before and after.

## Architecture

### 1. Extend the atomic AI patch vocabulary

Add `addClip` and `removeClip` to `AiEdit` in `src/editor/project-patches.ts`.

`addClip` carries a complete serializable `Clip` plus `sequenceId`. Applying it validates that the target track exists and is unlocked, the clip ID is unused, the clip targets that track, timing is valid, and any media asset exists and matches the clip's media use. The supplied clip is cloned into the sequence rather than regenerated so the proposal preview and approved apply use the exact same identity and values.

`removeClip` carries `sequenceId`, `clipId`, and optionally an expected asset/start guard where useful. Applying it validates the clip exists and its track is unlocked, then deletes it.

The global 5,000-edit patch cap remains unchanged.

### 2. Make approval previews structural-edit aware

`previewAnimeAiPatch` currently assumes non-track edits address a clip that exists in both the before and after project. Change its review-change representation so an added clip has `before: undefined`, a removed clip has `after: undefined`, and existing edit types retain before/after snapshots.

The proposal continues to contain the original patch and project fingerprint. `verifyApprovedProposal` remains the only approval verification primitive and re-applies the exact patch only if the current project fingerprint still matches.

### 3. Materialise PNGTuber mouth sync as a proposal

Add a pure planner in `anime-pngtuber-sync.ts` that converts `MouthInterval[]` into complete image clips. Inputs are:
- explicit target video track ID;
- explicit closed and open image asset IDs;
- a template/reference clip whose visual properties define avatar placement and styling;
- deterministic ID prefix supplied by the caller;
- the already-computed mouth intervals.

Each generated clip copies the template's visual properties (transform, colour, blend, animation/effects/crop/masks as appropriate), switches only the asset according to mouth state, and uses the interval's start/duration with source in-point zero. Generated clips are normal editable image clips.

The AI tool `propose_pngtuber_mouth_sync` validates the narration clip/waveform exactly as the existing planner does, validates target track/assets/template, computes mouth intervals, materialises clips, and returns an approval proposal containing `addClip` edits. It never mutates the live timeline.

To avoid silently stacking duplicate generated mouth tracks, the first version supports an explicit `replace_clip_ids` allow-list. Those exact clips are removed in the same proposal before the newly generated clips are added. It does not infer which existing clips are generated.

### 4. Safety and determinism

The tool refuses reverse or speed-ramped narration as the existing mouth planner does. It keeps the existing bounded interval/edit limits. IDs are deterministic within the proposal so preview and apply refer to identical clips. No generated operation is allowed on locked tracks.

Research, scene matching, and review-beat planning do not change in this subsystem. Once structural timeline edits are proven, anime-footage assembly can reuse `addClip`/`removeClip` rather than inventing a second mutation path.

## Testing

Use TDD in three layers:
1. `project-patches` tests for valid add/remove, unknown/locked track, duplicate IDs, missing assets and atomic clone behavior.
2. approval tests for added/removed review changes and stale-proposal rejection.
3. PNGTuber tests/tool tests for interval-to-image-clip conversion, copied layout, explicit asset selection, replacement allow-list, locked/invalid inputs, non-mutation, and registry exposure.

Run the existing anime-review tests, full `npm test`, and `npm run typecheck`. Exact branch-head GitHub Actions must pass before the feature is reported green.

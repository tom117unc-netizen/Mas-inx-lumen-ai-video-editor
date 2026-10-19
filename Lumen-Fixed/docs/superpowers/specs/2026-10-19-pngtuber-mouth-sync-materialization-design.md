# PNGTuber Mouth-Sync Materialization Design

## Goal
Turn the existing audio-driven `MouthInterval[]` plan into reviewable, stale-safe PNGTuber image clips on the timeline, without mutating the live project before explicit approval.

## User outcome
Given a narration clip plus explicit closed-mouth and open-mouth image assets, Lumen can generate the avatar's mouth animation across that narration. The generated mouth clips inherit the user's already-positioned/styled reference sprite so mouth sync does not move or visually reset the avatar.

## Constraints
- No filename guessing. Callers supply exact narration clip, reference sprite clip, closed asset, open asset and destination video track IDs.
- Source waveform observations remain the basis of mouth state planning.
- Planning and proposal creation are pure; the live timeline changes only through the existing `approveAiProposal` stale-fingerprint gate.
- One approved proposal becomes one undoable AI history entry.
- Generated clips must be bounded. The existing AI patch ceiling of 5000 edits remains the absolute safety ceiling; the mouth-sync tool uses a lower practical cap of 1200 generated intervals.
- Reverse narration and speed-ramped narration remain unsupported, matching the existing planner.
- Destination track must exist, be video, and be unlocked.
- Mouth assets must exist and be image assets.
- The reference sprite must be an image clip.

## Architecture
### 1. Extend the atomic AI patch format with `addClip`
`project-patches.ts` gains an `addClip` edit carrying a complete validated `Clip`. Applying it rejects duplicate IDs, unknown assets, missing/locked/wrong-kind tracks, invalid timing, and malformed image clips before inserting a structured clone into the target sequence.

This keeps clip creation inside the same pure patch engine already used by anime-review approval rather than adding a special mutation path.

### 2. Make review proposals understand additions
`previewAnimeAiPatch` represents an `addClip` change as `before: undefined` and `after: <created clip>`. `verifyApprovedProposal` remains unchanged: it fingerprints the reviewed project and re-applies the validated patch only if the timeline is still identical.

`approveAiProposal` learns how to commit an approved `addClip` by copying the verified created clip into the live draft. The entire proposal remains one history entry.

### 3. Materialize mouth intervals by cloning a reference sprite
A pure helper in `anime-pngtuber-sync.ts` converts `MouthInterval[]` to image clips. Each interval becomes one clip whose:
- `start` and `duration` exactly match the interval;
- `assetId` is the explicit closed/open asset for that state;
- `trackId` is the explicit destination video track;
- visual styling is cloned from the reference sprite: transform, color/look, blend, effects, crop, masks, keyframes where safe, animation and related visual properties;
- source-specific media timing is reset for a still image (`inPoint=0`, `speed=1`, `reverse=false`);
- ID is supplied deterministically by the proposal builder so preview and approval refer to the same clip.

The narration itself is never modified.

### 4. Add an AI proposal tool
`propose_pngtuber_mouth_sync` accepts exact IDs plus the same threshold/smoothing/hold/offset controls as the existing planning tool. It validates assets/clips/track, computes intervals from cached narration waveform peaks, materializes image clips, builds `addClip` edits, calls `previewAnimeAiPatch`, and returns the proposal with `mutation_applied:false` and `requires_approval:true`.

The existing `plan_pngtuber_mouth_sync` remains available for cheap inspection/tuning without generating a proposal.

## Failure behavior
The proposal is rejected before mutation when waveform peaks are missing, IDs are stale/unknown, the destination is not an unlocked video track, either mouth asset is not an image, the reference is not an image clip, reverse/speed-ramped narration is used, generated interval count exceeds the safety cap, or a generated clip ID collides.

If any project state changes after preview, existing fingerprint verification rejects approval and the user/agent must generate a fresh proposal.

## Testing
- `project-patches` tests prove `addClip` inserts a valid image clip and rejects duplicate IDs, unknown assets and locked/wrong-kind tracks.
- approval/store tests prove additions preview as before=undefined, commit atomically, and undo in one step.
- PNGTuber tests prove interval materialization covers exact frames, chooses correct assets, and preserves reference visual properties.
- integration tool tests prove the new proposal tool is registered and does not mutate the timeline while producing only `addClip` edits.
- Existing anime-review feature CI (`npm test`, `npm run typecheck`) remains the final gate.

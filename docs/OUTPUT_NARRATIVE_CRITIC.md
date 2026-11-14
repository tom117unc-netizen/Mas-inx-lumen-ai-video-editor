# Finished-video narrative critic (first implementation)

**Branch:** feature/contextual-video-construction — November 14, 2026.

## Why this exists

Lumen previously accepted an editor-written story/pacing assessment with an empty issue list once structural joins and general overview receipts were present. That gave no independent, machine-checkable assurance that the *published video* still contained its named challenge rules, round outcomes, setups, callbacks or ending.

This milestone adds **an objective, skeptical output audit**. It is run automatically by review_video_construction for a published keep-first sequence, even when the model says the film is perfect. The tool audit_output_narrative makes findings available early to the Director. get_video_construction exposes the current narrative audit.

## Checks performed

- Every essential event in the source-backed narrative ledger must appear in the output mapping **outside a teaser-only hook**.
- Each required event must be covered by *post-publication* output inspection receipts and focused/boundary inspections covering the complete required moment's output frames. A sparse overview, or a single image from a long essential event, cannot approve it. Original source analysis cannot silently stand in for finished-film inspection.
- Saved frame coordinates for mapped events must agree with actual selected original source spans and exact output placement.
- Required source-grounded rules/premise must precede essential round starts; each essential round must have a linked later outcome; every essential outcome must identify its actual round start.
- Essential callbacks and joke payoffs need earlier source-grounded setup links in final output order; an essential finale must be in the concluding section.
- Reconstructed multi-section edits may not pass with an empty source-backed story ledger. One untouched complete selection remains valid for no-edit diagnostic workflows.
- The final review automatically includes these deterministic findings among its repair issues; a confident model assessment cannot bypass them.

Checks are pure deterministic TypeScript, with focused regression tests. They add no remote model calls.

## Repair path

When an audit points to an unwitnessed moment, inspect the precise **finished output** section with inspect_video_range (and actual mixed audio if needed). When footage is missing, use reopen_construction_source_for_repair, revise the original authorised keep-first selections, and publish a new output version. Do not invent moments or import footage outside the original timeline.

## Important limitations

This is the first layer of the independent critic, **not an independently thinking audiovisual reviewer**. A receipt proves a tool ran, not that the AI interpreted the pictured event. Comedy timing, human watchability, clipped syllables, subtle sound transitions and genuine independent multimodal judgment remain outstanding. Held-out footage testing, Windows packaging, save/reopen and export validation are still release gates; a green unit build is not a quality guarantee.

## Relevant files

- Lumen-Fixed/src/editor/construction-output-critic.ts
- Lumen-Fixed/src/editor/construction-output-critic.test.ts
- Lumen-Fixed/src/integrations/tools/video-construction.ts
- Lumen-Fixed/electron/integrations/ai/construction-task-chain.ts

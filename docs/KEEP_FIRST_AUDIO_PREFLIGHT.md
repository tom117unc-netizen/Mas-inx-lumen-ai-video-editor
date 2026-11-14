# Source-join audio preflight — before editing the final video

**Implemented:** November 14, 2026, on feature/contextual-video-construction.

## Purpose

The existing output review measures sound only after a constructed cut is published. The new inspect_keep_first_join_audio tool lets Lumen audition a specific proposed transition **before publishing**, retaining the original recording and source map.

## Procedure

1. Complete whole-timeline context, event inspection, narrative ledger, local section plans and keep-first source selection.
2. Call preview_keep_first_assembly to obtain the ordered joins and the audio_preflight status for each.
3. For one join_index, inspect_keep_first_join_audio renders up to 0.5 seconds immediately before the left source selection ends and 0.5 seconds immediately after the right source selection begins. Only the clips already on the ORIGINAL authorised timeline are mixed. The two rendered source handles are concatenated in their proposed output order.
4. The tool saves a fingerprinted source-linked diagnostic with source coordinates, selected IDs and potential PCM click/level warnings; it also supplies a valid WAV to an audio-capable selected model. A text-only provider must not claim to hear the audio.
5. The Director can revise the precise source in/out frames if a line, laughter tail, game sound, music phrase or emotional rhythm would be damaged. Repeat until the proposed join sounds intentional, then publish and inspect the **actual rendered** output audio again.

## Guarantees and limits

- Each call is bounded to approximately one second of source audio and one proposed join. It cannot accidentally mix footage imported from outside the original authorised source timeline.
- Source fingerprints and exact left/right source frame coordinates prevent treating a stale audition as current when selections change; preview_keep_first_assembly reports whether matching source preflight was saved.
- No raw sample is persisted in the Lumen project; only source coordinates, bounded numeric observations and receipt IDs remain.
- The immediate audio samples are a **direct-splice approximation**, not necessarily the actual published mix. Source fades, clip transitions or output mixing can alter what is heard later.
- The numerical flags identify possible clicks/level shifts; they do not classify speech, humour, feelings or music. Correct semantic listening requires a supported audio-capable model and cautious assessment.
- No tool can guarantee every cut is good from PCM statistics. This preview is an available inspection step rather than a new unconditional publish gate for all legacy projects. The independent post-publish join review remains mandatory.

## Source

- Lumen-Fixed/src/editor/construction-splice-audio.ts (PCM concatenation)
- Lumen-Fixed/src/editor/construction-splice-audio.test.ts (sample and anomaly tests)
- Lumen-Fixed/src/integrations/tools/video-construction.ts (bounded source rendering, WAV transport, persistent receipt and preview status)
- Lumen-Fixed/electron/integrations/ai/construction-task-chain.ts (Director usage)

## Acceptance

On an actual Windows recording, pre-audition joins at a clipped word, laughter tail, music phrase and deliberate impact cut. Human-check that the attached sample matches the specified source-frame handles and that repairing the selection improves the eventual published result. Save/reopen the project and verify stale preflight is not treated as current. A green unit test or build alone does not prove the resulting edit sounds natural.

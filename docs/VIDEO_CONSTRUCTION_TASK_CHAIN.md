# Lumen: resumable micro-task chain for long video construction

**Status:** Implemented on `feature/contextual-video-construction` (14 November 2026). Code: `Lumen-Fixed/electron/integrations/ai/construction-task-chain.ts`, `construction-continuation.ts`, and `agent.ts`.

## Goal

A multi-hour video-editing job should not be one giant prompt or rely on a single uninterrupted provider call. Each Copilot model batch should perform a **small, verifiable task**, save its actual result to the open `.lumen` project, and rebuild the next prompt from that checkpoint. The project, not a long chat transcript, is the authority.

**Important:** No software can promise that a remote AI/network request will *never* time out. This design limits the damage: it makes transient failures recoverable while preserving completed work. Repeated failures, rejected credentials, explicit cancellation, and application shutdown can still stop a run. Explicit `resume_video_construction` continues from the saved state without restarting the whole edit.

## Execution model

1. The user explicitly requests a construction edit. `begin_video_construction` snapshots the current authorised timeline and saves the goal/state. A status-only question must not launch or resume editing.
2. When the construction tool executes, the Copilot switches from its ordinary 24-step budget to **7 steps per provider batch**, using at most **96 additional batches per explicitly requested run**.
3. After each successful batch, the main process calls `get_video_construction`, compares durable `revision`, inspection, scan, event and other work counters, and decides whether to continue. Completion, stale/paused state, no progress or a finite budget limit stops automatic execution.
4. A continuation sends a fresh **short, stage-specific prompt** generated solely from the persisted project: goal, saved revision, stage, scope's first missing range, transcript blockers, and small evidence counts. It directs the model to perform **one bounded work unit**:
   - **Discover:** transcribe one missing audible source or index one at-most-60-second original-timeline interval
   - **Investigate:** inspect one source range and save grounded findings
   - **Map:** create/revise one chapter or scene group with evidence
   - **Refine:** resolve one candidate or one context-reviewed cut
   - **Review:** inspect one output join or bounded output segment and record evidence
5. The full Copilot conversation remains stored separately, but the model does **not** resend the accumulated chat/tool transcript on every follow-on construction call. Each model window is rebuilt from project state, reducing context growth and stale assumptions.
6. The system explicitly saves the project after every substantive editor update; the monotonic `revision` catches changed decisions even when the number of beats or cuts has not changed.

## Failure and cancellation

- Each model stream has a **180-second deadline**. Sidecar vision calls inherit the same active batch signal.
- On transient HTTP statuses 408/409/425/429/5xx or recognizable connection and deadline failures, the Copilot **re-reads the durable construction state** before retrying. It does not replay incomplete tool-call transcripts.
- At most **3 recovery retries** are attempted for an interrupted construction call, with deterministic exponentially increased backoff (more cautious for HTTP 429). API authentication failures, bad requests, invalid editor operations or stale project state do not retry.
- If a provider request times out while an editor tool RPC is **still pending**, automatic retry is deliberately blocked to avoid racing or duplicating a destructive edit. The project remains checkable/resumable once that operation settles; the system does not claim exact-once distributed transaction semantics.
- An explicit user cancel aborts the current model request and any retry wait. No automatic model process continues in the background after the run ends.
- Model tool images, audio samples and sidecar result caches are released after each completed micro-batch or when recovering from failure. Raw WAV bytes are not saved to the project.
- The chain is **bounded**, not infinite. On model/provider failure, no progress or exhausted batch/retry budget, Lumen should report that the construction remains unfinished, identify the blocker and allow explicit resumption. A provider may still charge for an interrupted request. The saved .lumen edit and the provider's remote request are not a distributed atomic transaction.

## What this does and does not solve

**Improvements:** smaller prompts, lower accumulated context, narrower work units, more regular quality and persistence checkpoints, bounded recovery instead of discarding a whole session, progress tied to actual editor state, user cancellation, aggregated model-token totals across chained calls, and lower risk of memory bloat from repeated image/audio inspection.

**Not yet solved:** unbounded many-hour orchestration without a running app, automatic restart after system crash, comprehensive long-video background indexing, semantic recognition of jokes/gameplay, independent final video criticism, and non-destructive source restoration after deletion. Those require the follow-up source-backed EDL, local worker and independent critic. The 96-batch cap is a protection against runaway model usage, not an estimate that a four- or six-hour video will definitely finish in one run.

## Tests / acceptance

Pure tests cover small stage-oriented prompts, first missing frame range, missing-transcript priority, recovery instructions, provider transient/fatal classification, backoff, abortable retry waits, and finite budgets. Existing construction-continuation tests cover explicit opt-in, durable progress and budget limits.

Additional real-provider testing is required: induce a timeout **after** a successfully saved scan or cut, verify no tool side effects are duplicated, cancel in the middle of backoff, resume after closing/reopening a saved .lumen project, and check all source ranges remain on the original authorised timeline.

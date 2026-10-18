# Integrated, single-step AI approval for src/editor/store.ts

This patch adds a store action to commit an already-reviewed proposal as one undoable Immer history entry. It **does not** use loadProject (which clears undo history) or an unsafe sequence of partial dispatches.

1. Add the source files in this ZIP to `src/editor/`.
2. In `src/editor/store.ts`, add imports:

```ts
import { verifyApprovedProposal, type ReviewProposal } from './anime-review-approval'
```

3. Add this member to `interface EditorState`:

```ts
approveAiProposal: (proposal: ReviewProposal) => DispatchResult
```

4. Inside the Zustand store object, before `undo()`, insert:

```ts
approveAiProposal(proposal) {
  if (openTransaction) return { ok: false, error: 'Finish the current edit transaction first' }
  const before = get().project
  let next: Project
  let patches: Patch[]
  let inverse: Patch[]
  try {
    const approved = verifyApprovedProposal(before, proposal)
    ;[next, patches, inverse] = produceWithPatches(before, (draft) => {
      // The proposal was validated against exactly this project snapshot.
      // Assign only the top-level fields changed by the patch, preserving
      // Immer's ability to record one undoable history entry.
      for (const edit of proposal.patch.edits) {
        const openId = draft.sequence?.id ?? 'main'
        const dest = edit.sequenceId === openId ? draft : draft.sequences?.[edit.sequenceId]
        const source = edit.sequenceId === openId ? approved : approved.sequences?.[edit.sequenceId]
        if (!dest || !source) throw new Error('Sequence missing during commit')
        if (edit.op === 'setTrack') {
          const index = dest.tracks.findIndex(t => t.id === edit.trackId)
          if (index < 0) throw new Error('Track missing during commit')
          dest.tracks[index] = structuredClone(source.tracks[index])
        } else {
          dest.clips[edit.clipId] = structuredClone(source.clips[edit.clipId])
        }
      }
      normalizeProject(draft, before)
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (!patches.length) return { ok: true, result: { changes: 0 } }
  const entry: HistoryEntry = {
    id: nextEntryId++, label: 'Apply approved anime review edits', source: 'ai',
    patches, inverse, at: performance.now(),
  }
  set(s => ({ project: next, past: [...s.past, entry].slice(-HISTORY_LIMIT), future: [], version: s.version + 1 }))
  return { ok: true, result: { changes: proposal.changes.length } }
},
```

5. UI usage: call `previewAnimeAiPatch(useEditor.getState().project, patch)` and display `changes` and `warnings`; call `useEditor.getState().approveAiProposal(proposal)` only after explicit approval.

**Status:** reviewed against upstream store source; not compiled or executed inside the full Electron app. A finished UI and real project tests remain required.

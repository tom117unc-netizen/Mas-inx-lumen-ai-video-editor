/** AI proposal review and commit. Add beside src/editor/store.ts.
 * Preview is pure; commit is a single Immer history step via the store integration below.
 */
import type { Project } from './types'
import { applyAiPatch, type AiPatch } from './project-patches'

export interface ReviewChange {
  target: string
  before: unknown
  after: unknown
}
export interface ReviewProposal {
  patch: AiPatch
  /** Hash of the exact project snapshot reviewed, to prevent stale approvals. */
  fingerprint: string
  changes: ReviewChange[]
  warnings: string[]
}

/** Deterministic snapshot signature (not a cryptographic signature). */
export function projectFingerprint(project: Project): string {
  const json = JSON.stringify(project)
  let h = 2166136261
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${json.length}:${(h >>> 0).toString(16)}`
}

function locate(project: Project, id: string) {
  const openId = project.sequence?.id ?? 'main'
  return id === openId ? project : project.sequences?.[id]
}

export function previewAnimeAiPatch(project: Project, patch: AiPatch): ReviewProposal {
  const result = applyAiPatch(project, patch)
  const changes: ReviewChange[] = []
  for (const edit of patch.edits) {
    const before = locate(project, edit.sequenceId)
    const after = locate(result.project, edit.sequenceId)
    if (!before || !after) throw new Error('Sequence missing after patch')
    if (edit.op === 'setTrack') {
      changes.push({ target: `${edit.sequenceId}/track/${edit.trackId}`, before: structuredClone(before.tracks.find(t => t.id === edit.trackId)), after: structuredClone(after.tracks.find(t => t.id === edit.trackId)) })
    } else if (edit.op === 'addClip') {
      changes.push({ target: `${edit.sequenceId}/clip/${edit.clip.id}`, before: undefined, after: structuredClone(after.clips[edit.clip.id]) })
    } else {
      changes.push({ target: `${edit.sequenceId}/clip/${edit.clipId}`, before: structuredClone(before.clips[edit.clipId]), after: structuredClone(after.clips[edit.clipId]) })
    }
  }
  return { patch, fingerprint: projectFingerprint(project), changes, warnings: result.warnings }
}

/** Import this in store.ts. The store itself commits the already validated result atomically. */
export function verifyApprovedProposal(project: Project, proposal: ReviewProposal): Project {
  if (projectFingerprint(project) !== proposal.fingerprint) throw new Error('Timeline changed after preview; review the proposal again')
  return applyAiPatch(project, proposal.patch).project
}

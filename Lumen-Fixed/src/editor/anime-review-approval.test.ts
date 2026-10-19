import { describe, expect, it } from 'vitest'
import { createClip } from './defaults'
import { createEmptyProject } from './new-project'
import { previewAnimeAiPatch, verifyApprovedProposal } from './anime-review-approval'
import type { AiPatch } from './project-patches'
import type { Asset } from './types'

function imageAsset(id: string): Asset {
  return {
    id,
    name: `${id}.png`,
    kind: 'image',
    source: { type: 'file', url: `file:///${id}.png`, path: `C:\\sprites\\${id}.png`, mime: 'image/png', fileName: `${id}.png`, size: 1, mtime: 1 },
    addedAt: 1,
  }
}

function fixture() {
  const project = createEmptyProject('approval-test')
  project.assets.closed = imageAsset('closed')
  const track = project.tracks.find(track => track.kind === 'video')!
  const sequenceId = project.sequence?.id ?? 'main'
  const clips = ['mouth-1', 'mouth-2'].map((id, index) => createClip({ id, kind: 'image', assetId: 'closed', trackId: track.id, start: index * 10, duration: 10 }))
  const patch: AiPatch = {
    format: 'lumen-ai-patch', version: 1, projectId: project.id,
    edits: clips.map(clip => ({ op: 'addClip', sequenceId, clipId: clip.id, clip })),
  }
  return { project, patch, clips }
}

describe('anime AI proposal approval', () => {
  it('previews every generated clip without mutating the reviewed project', () => {
    const { project, patch, clips } = fixture()
    const before = JSON.stringify(project)
    const proposal = previewAnimeAiPatch(project, patch)

    expect(proposal.changes).toHaveLength(2)
    expect(proposal.changes.map(change => change.before)).toEqual([undefined, undefined])
    expect(proposal.changes.map(change => (change.after as { id: string }).id)).toEqual(clips.map(clip => clip.id))
    expect(JSON.stringify(project)).toBe(before)
  })

  it('approves a multi-clip proposal atomically into a new project snapshot', () => {
    const { project, patch, clips } = fixture()
    const approved = verifyApprovedProposal(project, previewAnimeAiPatch(project, patch))

    expect(clips.every(clip => approved.clips[clip.id]?.id === clip.id)).toBe(true)
    expect(clips.every(clip => project.clips[clip.id] === undefined)).toBe(true)
  })

  it('rejects the entire proposal when the reviewed timeline has changed', () => {
    const { project, patch, clips } = fixture()
    const proposal = previewAnimeAiPatch(project, patch)
    const changed = structuredClone(project)
    changed.name = 'changed after review'

    expect(() => verifyApprovedProposal(changed, proposal)).toThrow(/changed after preview|review the proposal again/i)
    expect(clips.every(clip => changed.clips[clip.id] === undefined)).toBe(true)
  })
})

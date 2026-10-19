import { describe, expect, it } from 'vitest'
import { createClip, createTrack } from './defaults'
import { createEmptyProject } from './new-project'
import { previewAnimeAiPatch, verifyApprovedProposal } from './anime-review-approval'
import { applyAiPatch } from './project-patches'
import { planMouthSync, planSpriteVersionReplacement } from './anime-pngtuber-sync'

describe('anime PNGTuber mouth planner', () => {
  it('covers the whole clip without gaps and respects timeline offsets', () => {
    const result = planMouthSync({ peaks: [0, 0, 0.5, 0.5, 0, 0], peaksPerSecond: 2 },
      { timelineStartFrame: 100, durationFrames: 90, sourceInSeconds: 0 },
      { fps: 30, smoothingMs: 0, minimumHoldFrames: 1 })
    expect(result[0].startFrame).toBe(100)
    expect(result.at(-1)?.endFrame).toBe(190)
    expect(result.some(x => x.state === 'open')).toBe(true)
    result.slice(1).forEach((x, i) => expect(x.startFrame).toBe(result[i].endFrame))
  })
  it('respects the source in-point after a trim', () => {
    const result = planMouthSync({ peaks: [0, 0, 1, 1], peaksPerSecond: 2 },
      { timelineStartFrame: 0, durationFrames: 10, sourceInSeconds: 1 },
      { fps: 10, smoothingMs: 0 })
    expect(result[0].state).toBe('open')
  })
  it('preserves sprite clip identity when planning version replacements', () => {
    expect(planSpriteVersionReplacement([{ id: 'clip1', assetId: 'old' }], { old: 'new' })).toEqual([
      { clipId: 'clip1', previousAssetId: 'old', replacementAssetId: 'new', preserveTiming: true },
    ])
  })
  it('applies an approved sprite asset swap without changing unrelated clip properties', () => {
    const project = createEmptyProject('PNGTuber test', { fps: 30 })
    const spriteTrack = createTrack('video', { id: 'video-1', name: 'PNGTuber' })
    project.tracks.push(spriteTrack)
    const fileSource = (name: string) => ({
      type: 'file' as const, url: `file:///${name}.png`, path: `C:\\sprites\\${name}.png`,
      mime: 'image/png', fileName: `${name}.png`, size: 1, mtime: 1,
    })
    project.assets.old = { id: 'old', name: 'old.png', kind: 'image', source: fileSource('old'), addedAt: 1 }
    project.assets.new = { id: 'new', name: 'new.png', kind: 'image', source: fileSource('new'), addedAt: 1 }
    project.clips.clip1 = createClip({ id: 'clip1', kind: 'image', assetId: 'old', trackId: spriteTrack.id, start: 42, duration: 90, transform: { opacity: 0.75 } })
    const patch = { format: 'lumen-ai-patch' as const, version: 1 as const, projectId: project.id, edits: [{ op: 'setAsset' as const, sequenceId: 'main', clipId: 'clip1', assetId: 'new' }] }
    const proposal = previewAnimeAiPatch(project, patch)
    const result = verifyApprovedProposal(project, proposal)
    expect(result.clips.clip1.assetId).toBe('new')
    expect(result.clips.clip1.start).toBe(42)
    expect(result.clips.clip1.duration).toBe(90)
    expect(result.clips.clip1.transform.opacity).toBe(0.75)
  })
  it('atomically adds a validated AI image clip and rejects unsafe destinations', () => {
    const project = createEmptyProject('add clip', { fps: 30 })
    const track = createTrack('video', { id: 'png-track', name: 'PNGTuber' })
    project.tracks.push(track)
    project.assets.mouth = { id: 'mouth', name: 'mouth.png', kind: 'image', source: { type: 'file', url: 'file:///mouth.png', mime: 'image/png', fileName: 'mouth.png', size: 1 }, addedAt: 1 }
    const clip = createClip({ id: 'mouth-1', kind: 'image', assetId: 'mouth', trackId: track.id, start: 10, duration: 5 })
    const patch = { format: 'lumen-ai-patch' as const, version: 1 as const, projectId: project.id, edits: [{ op: 'addClip' as const, sequenceId: 'main', clipId: clip.id, clip }] }
    const result = applyAiPatch(project, patch)
    expect(project.clips['mouth-1']).toBeUndefined()
    expect(result.project.clips['mouth-1']).toEqual(clip)
    expect(() => applyAiPatch(result.project, patch)).toThrow(/duplicate|already exists/i)
    const locked = structuredClone(project); locked.tracks.find(t => t.id === track.id)!.locked = true
    expect(() => applyAiPatch(locked, patch)).toThrow(/locked/i)
    const audio = structuredClone(project); audio.tracks.find(t => t.id === track.id)!.kind = 'audio'
    expect(() => applyAiPatch(audio, patch)).toThrow(/video/i)
    const unknownAsset = structuredClone(clip); unknownAsset.id = 'mouth-2'; unknownAsset.assetId = 'missing'
    expect(() => applyAiPatch(project, { ...patch, edits: [{ op: 'addClip' as const, sequenceId: 'main', clipId: unknownAsset.id, clip: unknownAsset }] })).toThrow(/asset/i)
  })
  it('rejects invalid sync thresholds', () => {
    expect(() => planMouthSync({ peaks: [], peaksPerSecond: 10 }, { timelineStartFrame: 0, durationFrames: 1, sourceInSeconds: 0 }, { fps: 30, openThreshold: 0.1, closeThreshold: 0.2 })).toThrow()
  })
})

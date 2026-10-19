import { describe, expect, it } from 'vitest'
import { createClip, createTrack } from './defaults'
import { createEmptyProject } from './new-project'
import { previewAnimeAiPatch, verifyApprovedProposal } from './anime-review-approval'
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
    project.clips.clip1 = createClip({
      id: 'clip1', kind: 'image', assetId: 'old', trackId: spriteTrack.id,
      start: 42, duration: 90, transform: { opacity: 0.75 },
    })
    const patch = {
      format: 'lumen-ai-patch' as const,
      version: 1 as const,
      projectId: project.id,
      edits: [{ op: 'setAsset' as const, sequenceId: 'main', clipId: 'clip1', assetId: 'new' }],
    }

    const proposal = previewAnimeAiPatch(project, patch)
    const result = verifyApprovedProposal(project, proposal)

    expect(result.clips.clip1.assetId).toBe('new')
    expect(result.clips.clip1.start).toBe(42)
    expect(result.clips.clip1.duration).toBe(90)
    expect(result.clips.clip1.transform.opacity).toBe(0.75)
  })
  it('rejects invalid sync thresholds', () => {
    expect(() => planMouthSync({ peaks: [], peaksPerSecond: 10 },
      { timelineStartFrame: 0, durationFrames: 1, sourceInSeconds: 0 },
      { fps: 30, openThreshold: 0.1, closeThreshold: 0.2 })).toThrow()
  })
})

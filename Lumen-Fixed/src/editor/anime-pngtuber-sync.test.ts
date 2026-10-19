import { describe, expect, it } from 'vitest'
import type { Project } from './types'
import { applyPatches } from './project-patches'
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
  it('applies a sprite asset swap without changing unrelated clip properties', () => {
    const project = {
      clips: {
        clip1: { id: 'clip1', assetId: 'old', start: 42, duration: 90, opacity: 0.75 },
      },
      assets: { old: { id: 'old' }, new: { id: 'new' } },
    } as unknown as Project

    const result = applyPatches(project, [{ op: 'setAsset', clipId: 'clip1', assetId: 'new' }])

    expect(result.project.clips.clip1.assetId).toBe('new')
    expect(result.project.clips.clip1.start).toBe(42)
    expect(result.project.clips.clip1.duration).toBe(90)
    expect(result.project.clips.clip1.opacity).toBe(0.75)
    expect(result.before).toEqual([{ op: 'setAsset', clipId: 'clip1', assetId: 'old' }])
  })
  it('rejects invalid sync thresholds', () => {
    expect(() => planMouthSync({ peaks: [], peaksPerSecond: 10 },
      { timelineStartFrame: 0, durationFrames: 1, sourceInSeconds: 0 },
      { fps: 30, openThreshold: 0.1, closeThreshold: 0.2 })).toThrow()
  })
})

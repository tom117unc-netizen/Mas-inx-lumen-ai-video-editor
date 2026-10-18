import { describe, expect, it } from 'vitest'
import { createClip, createTrack } from './defaults'
import { createEmptyProject } from './new-project'
import { createContextBankMirror } from './context-bank-mirror'
import type { Asset, Sequence } from './types'

function fileAsset(id: string, name: string): Asset {
  return {
    id,
    name,
    kind: 'video',
    duration: 1440,
    width: 1920,
    height: 1080,
    fps: 24,
    hasAudio: true,
    source: {
      type: 'file',
      url: `lumen-media://file/${id}`,
      path: `D:\\Anime\\${name}.mkv`,
      mime: 'video/x-matroska',
      fileName: `${name}.mkv`,
      size: 9_000_000_000,
      mtime: 123456,
    },
    peaks: [0.1, 0.9, 0.4],
    transcript: [{ start: 1, end: 2, text: 'heavy transcript body must not be mirrored' }],
    cues: [{ at: 4, kind: 'scene', label: 'large semantic payload' }],
    addedAt: 1,
  }
}

describe('createContextBankMirror', () => {
  it('creates a deterministic compact mirror of open and nested timelines', () => {
    const project = createEmptyProject('Review')
    project.id = 'project-1'
    project.assets = {
      zed: fileAsset('zed', 'Episode 02'),
      alpha: fileAsset('alpha', 'Episode 01'),
      generatedFrames: {
        id: 'generatedFrames', name: 'Frames', kind: 'image',
        source: { type: 'sequence', base: 'lumen-media://frames', pattern: '%04d.png', frameCount: 20, fps: 30 },
        addedAt: 2,
      },
    }

    const mainTrack = project.tracks.find(track => track.kind === 'video')!
    const mainClip = createClip({ kind: 'video', trackId: mainTrack.id, start: 90, duration: 120, assetId: 'zed' })
    mainClip.id = 'shared-clip'
    mainClip.name = 'Main usage'
    mainClip.inPoint = 240
    mainClip.keyframes.speed = [{ frame: 0, value: 1, easing: 'linear' }, { frame: 60, value: 1.5, easing: 'linear' }]
    project.clips = { [mainClip.id]: mainClip }
    project.markers = [
      { id: 'marker-b', frame: 200, label: 'Later', color: 'amber' },
      { id: 'marker-a', frame: 20, label: 'Earlier', color: 'lime' },
    ]

    const nestedTrack = createTrack('video', { name: 'Nested Video' })
    const nestedClip = createClip({ kind: 'video', trackId: nestedTrack.id, start: 10, duration: 50, assetId: 'alpha' })
    nestedClip.id = 'shared-clip'
    nestedClip.name = 'Nested usage'
    const nested: Sequence = {
      id: 'sequence-b', name: 'B sequence', settings: { ...project.settings, fps: 24 },
      tracks: [nestedTrack], clips: { [nestedClip.id]: nestedClip },
      markers: [{ id: 'nested-marker', frame: 12, label: 'Nested', color: 'sky' }], createdAt: 2,
    }
    project.sequences = { [nested.id]: nested }

    const first = createContextBankMirror(project, 11)
    const second = createContextBankMirror(project, 11)
    expect(second).toEqual(first)
    expect(first).toMatchObject({ format: 'lumen-context-mirror', version: 1, projectId: 'project-1', projectName: 'Review', revision: 11 })
    expect(first.assets.map(asset => asset.id)).toEqual(['alpha', 'zed'])
    expect(first.sequences.map(sequence => sequence.id)).toEqual(['main', 'sequence-b'])
    expect(first.sequences[0].markers.map(marker => marker.markerId)).toEqual(['marker-a', 'marker-b'])
    expect(first.sequences.flatMap(sequence => sequence.clips.map(clip => [clip.sequenceId, clip.clipId]))).toEqual([
      ['main', 'shared-clip'],
      ['sequence-b', 'shared-clip'],
    ])
    expect(first.sequences[0].clips[0]).toMatchObject({ inPoint: 240, hasSpeedRamp: true, reverse: false, freeze: false })
  })

  it('never carries runtime urls, waveforms, transcripts, cues, or sequence-frame payloads', () => {
    const project = createEmptyProject('Compact')
    project.id = 'project-compact'
    project.assets.asset = fileAsset('asset', 'Episode 01')
    const mirror = createContextBankMirror(project, 0)
    const json = JSON.stringify(mirror)
    expect(json).not.toContain('lumen-media://')
    expect(json).not.toContain('transcript')
    expect(json).not.toContain('peaks')
    expect(json).not.toContain('cues')
    expect(json).not.toContain('heavy transcript body')
  })
})

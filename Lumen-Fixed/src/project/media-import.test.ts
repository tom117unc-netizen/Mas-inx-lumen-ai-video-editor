import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaFileInfo } from '@shared/app'

const mocks = vi.hoisted(() => ({
  project: { assets: {}, clips: {} } as { assets: Record<string, any>; clips: Record<string, any> },
  nextId: 0,
  probeMedia: vi.fn(),
  dispatch: vi.fn(),
  setLeftTab: vi.fn(),
  transcribeMedia: vi.fn(),
  transcribeAsset: vi.fn(),
  putTranscript: vi.fn(),
  putObservations: vi.fn(),
  audioSourceUrl: vi.fn(() => null),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(() => 'toast-1'),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@/editor/store', () => ({
  getProject: () => mocks.project,
  dispatch: mocks.dispatch,
  useEditor: {
    getState: () => ({
      transaction: (_label: string, _source: string, fn: () => void) => fn(),
    }),
  },
}))

vi.mock('@/editor/ui-store', () => ({
  useUI: { getState: () => ({ setLeftTab: mocks.setLeftTab }) },
}))

vi.mock('@/engine/decode', () => ({
  MediaError: class MediaError extends Error { detail?: string },
  kindFromMime: (mime: string) => mime.startsWith('video/') ? 'video' : null,
  probeMedia: mocks.probeMedia,
}))

vi.mock('@/engine/audio-engine', () => ({
  audioLeaves: vi.fn(() => []),
  audioSourceUrl: mocks.audioSourceUrl,
  computePeaks: vi.fn(),
  computePeaksStreamed: vi.fn(),
  isLongAudio: vi.fn(() => false),
  loadAudio: vi.fn(),
  pruneAudio: vi.fn(),
}))

vi.mock('@/lib/id', () => ({ uid: () => `asset-${++mocks.nextId}` }))

vi.mock('@/lib/platform', () => ({
  desktop: {
    files: {
      pickMedia: vi.fn(),
      register: vi.fn(),
      pathForFile: vi.fn(),
      relink: vi.fn(),
    },
    contextBank: {
      putTranscript: mocks.putTranscript,
      putObservations: mocks.putObservations,
    },
  },
}))

// These are deliberately mocked even though the import path does not currently
// depend on them. If ordinary media import ever starts semantic analysis, these
// spies make the regression visible immediately.
vi.mock('./transcribe', () => ({ transcribeMedia: mocks.transcribeMedia }))
vi.mock('@/integrations/store', () => ({ transcribeAsset: mocks.transcribeAsset }))
vi.mock('./subtitle-files', () => ({ loadSubtitleFile: vi.fn() }))

import { importMediaFiles } from './media-import'

function episode(index: number): MediaFileInfo {
  const number = String(index).padStart(2, '0')
  return {
    path: `D:\\Anime\\Series\\Episode ${number}.mkv`,
    url: `lumen-media://episode-${number}`,
    name: `Episode ${number}.mkv`,
    size: 2_000_000_000 + index,
    mime: 'video/x-matroska',
    mtime: 1_000 + index,
  }
}

describe('ordinary episode import', () => {
  beforeEach(() => {
    mocks.project.assets = {}
    mocks.project.clips = {}
    mocks.nextId = 0
    mocks.probeMedia.mockReset().mockResolvedValue({
      kind: 'video',
      duration: 1_440,
      width: 1920,
      height: 1080,
      fps: 23.976,
      hasAudio: true,
      poster: undefined,
    })
    mocks.dispatch.mockReset().mockImplementation((operation: string, payload: { asset?: any }) => {
      if (operation === 'asset.add' && payload.asset) mocks.project.assets[payload.asset.id] = payload.asset
    })
    mocks.setLeftTab.mockReset()
    mocks.transcribeMedia.mockReset()
    mocks.transcribeAsset.mockReset()
    mocks.putTranscript.mockReset()
    mocks.putObservations.mockReset()
    mocks.audioSourceUrl.mockReset().mockReturnValue(null)
  })

  it('catalogues and probes a 12-episode batch without transcribing or semantically analysing any episode', async () => {
    const files = Array.from({ length: 12 }, (_, index) => episode(index + 1))

    const assets = await importMediaFiles(files)
    // Let the fire-and-forget waveform pass run; audioSourceUrl=null makes it a
    // no-op while still exercising the exact post-import scheduling path.
    await Promise.resolve()

    expect(assets).toHaveLength(12)
    expect(Object.keys(mocks.project.assets)).toHaveLength(12)
    expect(mocks.probeMedia).toHaveBeenCalledTimes(12)
    expect(mocks.dispatch).toHaveBeenCalledTimes(12)
    expect(mocks.setLeftTab).toHaveBeenCalledWith('media')

    expect(mocks.transcribeMedia).not.toHaveBeenCalled()
    expect(mocks.transcribeAsset).not.toHaveBeenCalled()
    expect(mocks.putTranscript).not.toHaveBeenCalled()
    expect(mocks.putObservations).not.toHaveBeenCalled()
  })
})

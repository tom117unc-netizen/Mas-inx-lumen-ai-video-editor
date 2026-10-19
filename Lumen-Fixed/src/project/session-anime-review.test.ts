import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const editorState = {
    version: 0,
    project: { id: 'initial', name: 'Initial' } as any,
    loadProject: vi.fn((project: any) => {
      editorState.project = project
      editorState.version += 1
    }),
  }
  const useEditor = Object.assign(
    vi.fn((selector: (state: typeof editorState) => unknown) => selector(editorState)),
    {
      getState: () => editorState,
      subscribe: vi.fn(() => () => {}),
    },
  )
  return {
    editorState,
    useEditor,
    saveAs: vi.fn(),
    autosave: vi.fn(async () => {}),
    setState: vi.fn(),
    clearSelection: vi.fn(),
    requestFit: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
  }
})

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => 'toast'),
    dismiss: vi.fn(),
  },
}))

vi.mock('@/editor/store', () => ({
  getProject: () => mocks.editorState.project,
  migrateProject: (project: any) => project,
  useEditor: mocks.useEditor,
}))

vi.mock('@/editor/playback', () => ({
  playback: { pause: mocks.pause, seek: mocks.seek },
}))

vi.mock('@/editor/ui-store', () => ({
  useUI: {
    getState: () => ({
      clearSelection: mocks.clearSelection,
      requestFit: mocks.requestFit,
      setLeftTab: vi.fn(),
    }),
  },
}))

vi.mock('@/lib/platform', () => ({
  desktop: {
    project: {
      saveAs: mocks.saveAs,
      autosave: mocks.autosave,
      setState: mocks.setState,
      recent: vi.fn(async () => []),
      confirmDiscard: vi.fn(async () => 'discard'),
    },
  },
}))

import { newProject, useSession } from './session'

describe('anime review project creation lifecycle', () => {
  beforeEach(() => {
    mocks.editorState.version = 0
    mocks.editorState.project = { id: 'initial', name: 'Initial' }
    mocks.editorState.loadProject.mockClear()
    mocks.saveAs.mockReset()
    mocks.autosave.mockClear()
    mocks.setState.mockClear()
    mocks.clearSelection.mockClear()
    mocks.requestFit.mockClear()
    mocks.pause.mockClear()
    mocks.seek.mockClear()
    useSession.setState({ path: null, savedVersion: 0, home: true, recent: [], recovery: null, busy: false, hasProject: false })
  })

  it('keeps ordinary project creation unsaved and does not open Save As', async () => {
    await expect(newProject({ width: 1920, height: 1080, fps: 30 }, 'Ordinary')).resolves.toBe(true)
    expect(mocks.editorState.project.name).toBe('Ordinary')
    expect(mocks.editorState.project.animeReview).toBeUndefined()
    expect(mocks.saveAs).not.toHaveBeenCalled()
    expect(useSession.getState().path).toBeNull()
  })

  it('immediately asks for a durable location when a show title is supplied', async () => {
    mocks.saveAs.mockResolvedValueOnce({ path: 'D:\\Reviews\\Frieren\\Frieren.lumen' })

    await expect(newProject(
      { width: 1920, height: 1080, fps: 30 },
      'Frieren',
      { version: 1, showQuery: '  Frieren  ' },
    )).resolves.toBe(true)

    expect(mocks.editorState.project.animeReview).toEqual({ version: 1, showQuery: 'Frieren' })
    expect(mocks.saveAs).toHaveBeenCalledTimes(1)
    expect(mocks.saveAs.mock.calls[0]?.[0]).toBe('Frieren')
    expect(JSON.parse(mocks.saveAs.mock.calls[0]?.[1] as string).animeReview).toEqual({ version: 1, showQuery: 'Frieren' })
    expect(useSession.getState().path).toBe('D:\\Reviews\\Frieren\\Frieren.lumen')
  })

  it('keeps the anime review project open but unsaved when Save As is cancelled', async () => {
    mocks.saveAs.mockResolvedValueOnce(null)

    await expect(newProject(
      { width: 1920, height: 1080, fps: 30 },
      'Frieren',
      { version: 1, showQuery: 'Frieren' },
    )).resolves.toBe(true)

    expect(mocks.editorState.project.animeReview?.showQuery).toBe('Frieren')
    expect(useSession.getState()).toMatchObject({ path: null, home: false, hasProject: true })
    expect(mocks.saveAs).toHaveBeenCalledTimes(1)
  })
})

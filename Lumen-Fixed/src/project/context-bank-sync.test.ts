import { describe, expect, it, vi } from 'vitest'
import type { ContextBankAPI, ContextBankStatus } from '@shared/context-bank'
import { createEmptyProject } from '@/editor/new-project'
import type { CommittedEditEvent } from '@/editor/store'
import { createContextBankSynchronizer } from './context-bank-sync'

const status = (projectId: string, projectPath: string, revision: number): ContextBankStatus => ({
  available: true,
  projectId,
  projectPath,
  schemaVersion: 1,
  revision,
  assetCount: 0,
  clipCount: 0,
  markerCount: 0,
  editEventCount: 0,
  warnings: [],
})

function api(sync: ContextBankAPI['sync']): ContextBankAPI {
  return {
    sync,
    query: vi.fn(),
    status: vi.fn(),
    copyForSaveAs: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  }
}

describe('Context Bank renderer synchronizer', () => {
  it('does nothing on disk while the project is unsaved', async () => {
    const project = createEmptyProject('Unsaved')
    const sync = vi.fn<ContextBankAPI['sync']>()
    const bank = createContextBankSynchronizer(api(sync), () => ({ project, revision: 4, projectPath: null }))
    await bank.reconcile()
    await bank.record({ kind: 'dispatch', revision: 4, historyId: 1, label: 'Edit', source: 'user', at: 10 })
    await bank.flush()
    expect(sync).not.toHaveBeenCalled()
  })

  it('captures the canonical mirror and committed mutation at enqueue time', async () => {
    const project = createEmptyProject('Saved')
    project.id = 'project-1'
    const sync = vi.fn<ContextBankAPI['sync']>(async request => status(request.mirror.projectId, request.projectPath, request.mirror.revision))
    const bank = createContextBankSynchronizer(api(sync), () => ({ project, revision: 8, projectPath: 'D:\\Reviews\\review.lumen' }))
    const event: CommittedEditEvent = { kind: 'dispatch', revision: 8, historyId: 12, label: 'Cut narration', source: 'ai', at: 99 }
    await bank.record(event)
    expect(sync).toHaveBeenCalledTimes(1)
    expect(sync.mock.calls[0][0]).toMatchObject({
      projectPath: 'D:\\Reviews\\review.lumen',
      mirror: { projectId: 'project-1', revision: 8 },
      mutation: { kind: 'dispatch', revision: 8, historyId: 12, label: 'Cut narration', source: 'ai', at: 99 },
    })
  })

  it('ignores load events so an opened project cannot be written into the previous project path', async () => {
    const project = createEmptyProject('Opened')
    const sync = vi.fn<ContextBankAPI['sync']>()
    const bank = createContextBankSynchronizer(api(sync), () => ({ project, revision: 3, projectPath: 'D:\\Old\\old.lumen' }))
    await bank.record({ kind: 'load', revision: 3, at: 20 })
    expect(sync).not.toHaveBeenCalled()
  })

  it('serializes writes and keeps later syncs alive after an earlier failure', async () => {
    const project = createEmptyProject('Queue')
    project.id = 'project-queue'
    let revision = 1
    let inFlight = 0
    let maximumInFlight = 0
    const seen: number[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>(resolve => { releaseFirst = resolve })
    const sync = vi.fn<ContextBankAPI['sync']>(async request => {
      inFlight++
      maximumInFlight = Math.max(maximumInFlight, inFlight)
      seen.push(request.mirror.revision)
      if (request.mirror.revision === 1) {
        await firstGate
        inFlight--
        throw new Error('temporary failure')
      }
      inFlight--
      return status(request.mirror.projectId, request.projectPath, request.mirror.revision)
    })
    const bank = createContextBankSynchronizer(api(sync), () => ({ project, revision, projectPath: 'D:\\Reviews\\queue.lumen' }), () => {})
    const first = bank.record({ kind: 'dispatch', revision: 1, historyId: 1, at: 1 })
    revision = 2
    const second = bank.record({ kind: 'dispatch', revision: 2, historyId: 2, at: 2 })
    await Promise.resolve()
    expect(maximumInFlight).toBe(1)
    releaseFirst()
    await expect(first).rejects.toThrow('temporary failure')
    await expect(second).resolves.toBeUndefined()
    expect(seen).toEqual([1, 2])
    expect(maximumInFlight).toBe(1)
  })

  it('serializes Save As copy before edits can sync into the new path', async () => {
    const project = createEmptyProject('Save As queue')
    project.id = 'project-save-as'
    let projectPath = 'D:\\Reviews\\old.lumen'
    let revision = 4
    let releaseCopy!: () => void
    const copyGate = new Promise<void>(resolve => { releaseCopy = resolve })
    const sync = vi.fn<ContextBankAPI['sync']>(async request => status(request.mirror.projectId, request.projectPath, request.mirror.revision))
    const copyForSaveAs = vi.fn<ContextBankAPI['copyForSaveAs']>(async () => { await copyGate })
    const contextApi = api(sync)
    contextApi.copyForSaveAs = copyForSaveAs
    const bank = createContextBankSynchronizer(contextApi, () => ({ project, revision, projectPath }))

    await bank.reconcile()
    projectPath = 'D:\\Reviews\\copy.lumen'
    const copy = bank.copyForSaveAs('D:\\Reviews\\old.lumen', projectPath)
    revision = 5
    const edit = bank.record({ kind: 'dispatch', revision: 5, historyId: 5, at: 5 })
    await Promise.resolve()
    expect(copyForSaveAs).toHaveBeenCalledTimes(1)
    expect(sync).toHaveBeenCalledTimes(1)

    releaseCopy()
    await copy
    await edit
    expect(sync).toHaveBeenCalledTimes(2)
    expect(sync.mock.calls[1][0]).toMatchObject({ projectPath: 'D:\\Reviews\\copy.lumen', mirror: { revision: 5 } })
  })
})

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
    putTranscript: vi.fn(),
    getTranscript: vi.fn(),
    putObservations: vi.fn(),
    getObservations: vi.fn(),
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

  it('queues Save As copying behind prior writes and allows a later reconciliation', async () => {
    const project = createEmptyProject('Copy')
    project.id = 'project-copy'
    let releaseSync!: () => void
    const gate = new Promise<void>(resolve => { releaseSync = resolve })
    const calls: string[] = []
    const sync = vi.fn<ContextBankAPI['sync']>(async request => {
      calls.push(`sync:${request.projectPath}`)
      await gate
      return status(request.mirror.projectId, request.projectPath, request.mirror.revision)
    })
    const bankApi = api(sync)
    bankApi.copyForSaveAs = vi.fn(async (_projectId, from, to) => { calls.push(`copy:${from}->${to}`) })
    let projectPath = 'D:\\Old\\review.lumen'
    const bank = createContextBankSynchronizer(bankApi, () => ({ project, revision: 1, projectPath }))
    const pending = bank.record({ kind: 'dispatch', revision: 1, historyId: 1, at: 1 })
    const copying = bank.copyForSaveAs(projectPath, 'E:\\New\\review.lumen')
    projectPath = 'E:\\New\\review.lumen'
    releaseSync()
    await pending
    await copying
    await bank.reconcile()
    expect(calls).toEqual([
      'sync:D:\\Old\\review.lumen',
      'copy:D:\\Old\\review.lumen->E:\\New\\review.lumen',
      'sync:E:\\New\\review.lumen',
    ])
  })
})

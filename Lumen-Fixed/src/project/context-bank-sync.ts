import type { ContextBankAPI, ContextBankMutation, ContextBankSyncRequest } from '@shared/context-bank'
import { createContextBankMirror } from '@/editor/context-bank-mirror'
import type { CommittedEditEvent } from '@/editor/store'
import type { Project } from '@/editor/types'

export interface ContextBankSyncSnapshot {
  project: Project
  revision: number
  projectPath: string | null
}

export interface ContextBankSynchronizer {
  record(event: CommittedEditEvent): Promise<void>
  reconcile(): Promise<void>
  flush(): Promise<void>
  copyForSaveAs(fromProjectPath: string, toProjectPath: string): Promise<void>
}

/**
 * Serializes renderer → Electron Context Bank writes. The mirror is captured when
 * an edit commits, so a slow disk write can never pair an old event with a newer timeline.
 */
export function createContextBankSynchronizer(
  api: ContextBankAPI | undefined,
  snapshot: () => ContextBankSyncSnapshot,
  onError: (error: unknown) => void = error => console.warn('Context Bank sync failed', error),
): ContextBankSynchronizer {
  // `tail` is always resolved: each individual caller still receives its own rejecting
  // promise, while the queue catches that rejection before scheduling the next write.
  let tail: Promise<void> = Promise.resolve()

  const preserveQueue = (run: Promise<void>) => {
    tail = run.catch(error => { onError(error) })
    return run
  }

  const enqueue = (event?: CommittedEditEvent): Promise<void> => {
    if (!api) return Promise.resolve()
    const current = snapshot()
    if (!current.projectPath) return Promise.resolve()

    const mutation: ContextBankMutation | undefined = event && event.kind !== 'load'
      ? {
          kind: event.kind,
          revision: event.revision,
          ...(event.historyId === undefined ? {} : { historyId: event.historyId }),
          ...(event.label === undefined ? {} : { label: event.label }),
          ...(event.source === undefined ? {} : { source: event.source }),
          at: event.at,
        }
      : undefined

    const request: ContextBankSyncRequest = {
      projectPath: current.projectPath,
      mirror: createContextBankMirror(current.project, current.revision),
      ...(mutation ? { mutation } : {}),
    }

    const run = tail
      .then(() => api.sync(request))
      .then(() => {})
    // Preserve failure for this caller, but make the queue itself recover so later
    // commits are never blocked by an earlier transient disk/IPC error.
    return preserveQueue(run)
  }

  return {
    record(event) {
      // loadProject fires before session.ts swaps the active path. Ignoring it here
      // prevents the newly opened project from ever being mirrored into the old path.
      if (event.kind === 'load') return Promise.resolve()
      return enqueue(event)
    },
    reconcile() {
      return enqueue()
    },
    flush() {
      return tail
    },
    copyForSaveAs(fromProjectPath, toProjectPath) {
      if (!api || !fromProjectPath || !toProjectPath || fromProjectPath === toProjectPath) return Promise.resolve()
      // Capture the project id now and put the copy itself in the same queue as syncs.
      // A user edit made immediately after Save As therefore waits for the copied DB
      // instead of racing it and being overwritten by a late file copy.
      const projectId = snapshot().project.id
      const run = tail
        .then(() => api.copyForSaveAs(projectId, fromProjectPath, toProjectPath))
        .then(() => {})
      return preserveQueue(run)
    },
  }
}

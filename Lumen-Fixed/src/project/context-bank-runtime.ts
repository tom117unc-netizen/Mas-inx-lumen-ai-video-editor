import { getProject, subscribeCommittedEdits, useEditor } from '@/editor/store'
import { desktop } from '@/lib/platform'
import { useSession } from './session'
import { createContextBankSynchronizer, type ContextBankSynchronizer } from './context-bank-sync'

export type ContextBankPathAction = 'none' | 'reconcile' | 'copy'

export function contextBankPathAction(
  previousPath: string | null,
  nextPath: string | null,
  previousProjectId: string,
  currentProjectId: string,
  loadCausedTransition: boolean,
): ContextBankPathAction {
  if (!nextPath) return 'none'
  if (
    previousPath
    && previousPath !== nextPath
    && !loadCausedTransition
    && previousProjectId === currentProjectId
  ) return 'copy'
  return 'reconcile'
}

let started = false
let activeSynchronizer: ContextBankSynchronizer | null = null

/** Waits until every Context Bank write already queued by committed edits has finished. */
export async function flushContextBankWrites() {
  await activeSynchronizer?.flush()
}

/**
 * Connects successful editor commits and project-path changes to the persistent
 * Context Bank. Project loads are reconciled only after session.ts has installed
 * the new path, which prevents cross-project cache writes.
 */
export function startContextBankRuntime() {
  if (started) return
  started = true

  const synchronizer = createContextBankSynchronizer(
    desktop?.contextBank,
    () => ({
      project: getProject(),
      revision: useEditor.getState().version,
      projectPath: useSession.getState().path,
    }),
  )
  activeSynchronizer = synchronizer

  let previousProjectId = getProject().id
  let sawLoad = false

  subscribeCommittedEdits(event => {
    if (event.kind === 'load') {
      sawLoad = true
      // loadProject fires before session.ts changes `path`. Defer reconciliation
      // until the current call stack has installed the new session state.
      queueMicrotask(() => {
        if (useSession.getState().path) void synchronizer.reconcile().catch(() => {})
      })
      return
    }
    void synchronizer.record(event).catch(() => {})
  })

  useSession.subscribe((state, previous) => {
    if (state.path === previous.path) return
    const currentProjectId = getProject().id
    const action = contextBankPathAction(previous.path, state.path, previousProjectId, currentProjectId, sawLoad)
    const from = previous.path
    const to = state.path
    previousProjectId = currentProjectId
    const loaded = sawLoad
    sawLoad = false

    if (action === 'copy' && from && to) {
      void synchronizer.copyForSaveAs(from, to)
        .then(() => synchronizer.reconcile())
        .catch(() => {})
    } else if (action === 'reconcile' && to && !loaded) {
      void synchronizer.reconcile().catch(() => {})
    }
  })
}

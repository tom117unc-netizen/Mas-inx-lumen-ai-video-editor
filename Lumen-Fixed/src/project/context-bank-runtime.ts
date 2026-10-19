import { getProject, subscribeCommittedEdits, useEditor } from '@/editor/store'
import type { Project } from '@/editor/types'
import { api as integrationsApi } from '@/integrations/store'
import { desktop } from '@/lib/platform'
import { seedAnimeResearchForProject } from './anime-research'
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

/**
 * A durable path is the hard boundary for project-local Context Bank work.
 * Reconcile first so research status always reads from an initialized/current
 * bank; only anime-review projects proceed to network-backed research seeding.
 */
export async function runAnimeResearchAfterContextBankSync(
  project: Project,
  projectPath: string | null,
  reconcile: () => Promise<void>,
  seed: (project: Project, projectPath: string) => Promise<unknown>,
) {
  if (!projectPath) return
  await reconcile()
  if (!project.animeReview?.showQuery) return
  await seed(project, projectPath)
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

  const seed = async (project: Project, projectPath: string) => {
    if (!desktop?.contextBank || !integrationsApi) return
    // The path may have changed while a queued Context Bank write was finishing.
    // Avoid spending network work on a project that is no longer active.
    if (getProject().id !== project.id || useSession.getState().path !== projectPath) return
    await seedAnimeResearchForProject(project, projectPath, {
      bank: desktop.contextBank,
      integrations: integrationsApi,
    })
  }

  const reconcileAndResearch = (project: Project, projectPath: string | null) =>
    runAnimeResearchAfterContextBankSync(project, projectPath, () => synchronizer.reconcile(), seed)

  let previousProjectId = getProject().id
  let sawLoad = false

  subscribeCommittedEdits(event => {
    if (event.kind === 'load') {
      sawLoad = true
      // loadProject fires before session.ts changes `path`. Defer reconciliation
      // until the current call stack has installed the new session state.
      queueMicrotask(() => {
        const project = getProject()
        const path = useSession.getState().path
        if (path) void reconcileAndResearch(project, path).catch(error => console.warn('Anime research initialization failed', error))
      })
      return
    }
    void synchronizer.record(event).catch(() => {})
  })

  useSession.subscribe((state, previous) => {
    if (state.path === previous.path) return
    const project = getProject()
    const currentProjectId = project.id
    const action = contextBankPathAction(previous.path, state.path, previousProjectId, currentProjectId, sawLoad)
    const from = previous.path
    const to = state.path
    previousProjectId = currentProjectId
    const loaded = sawLoad
    sawLoad = false

    if (action === 'copy' && from && to) {
      void synchronizer.copyForSaveAs(from, to)
        .then(() => reconcileAndResearch(project, to))
        .catch(error => console.warn('Context Bank Save As initialization failed', error))
    } else if (action === 'reconcile' && to && !loaded) {
      void reconcileAndResearch(project, to).catch(error => console.warn('Context Bank initialization failed', error))
    }
  })
}

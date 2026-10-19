import type { ContextBankObservationQuery, ContextBankObservationResult, ContextBankObservationWriteRequest } from '../shared/context-bank-analysis'
import {
  clearContextBank,
  contextBankPath,
  copyContextBankForSaveAs,
  openContextBank as openCoreContextBank,
  type ContextBankStore,
} from './context-bank-core'
import { getSourceObservations, putSourceObservations } from './context-bank-observations'

export { clearContextBank, contextBankPath, copyContextBankForSaveAs }
export type { ContextBankStore }

/**
 * Opens the durable Context Bank and composes reusable source-analysis methods
 * around the core mirror/transcript store. Source observations live in their
 * own module so media-analysis indexing can evolve without bloating the
 * timeline-mirror persistence code.
 */
export function openContextBank(projectPath: string, projectId: string): ContextBankStore {
  const store = openCoreContextBank(projectPath, projectId)
  const databasePath = contextBankPath(projectPath, projectId)

  store.putObservations = (request: ContextBankObservationWriteRequest): ContextBankObservationResult =>
    putSourceObservations(databasePath, projectPath, projectId, request)
  store.getObservations = (request: ContextBankObservationQuery): ContextBankObservationResult =>
    getSourceObservations(databasePath, projectPath, projectId, request)

  return store
}

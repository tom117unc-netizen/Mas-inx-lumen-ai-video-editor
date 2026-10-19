import type { ContextBankObservationQuery, ContextBankObservationResult, ContextBankObservationWriteRequest } from '../shared/context-bank-analysis'
import type {
  ContextBankResearchPriorWriteRequest,
  ContextBankResearchPriorWriteResult,
  ContextBankResearchSearchRequest,
  ContextBankResearchSearchResult,
  ContextBankResearchSeedWriteRequest,
  ContextBankResearchStateWriteRequest,
  ContextBankResearchStatusRequest,
  ContextBankResearchStatusResult,
} from '../shared/context-bank-research'
import {
  clearContextBank as clearCoreContextBank,
  contextBankPath,
  copyContextBankForSaveAs,
  openContextBank as openCoreContextBank,
  type ContextBankStore as CoreContextBankStore,
} from './context-bank-core'
import { getSourceObservations, putSourceObservations } from './context-bank-observations'
import {
  clearShowResearch,
  getShowResearchStatus,
  putShowResearchPrior,
  replaceShowResearchSeed,
  searchShowResearch,
  setShowResearchState,
} from './context-bank-research'

export interface ContextBankStore extends CoreContextBankStore {
  getResearchStatus(request: ContextBankResearchStatusRequest): ContextBankResearchStatusResult
  setResearchState(request: ContextBankResearchStateWriteRequest): ContextBankResearchStatusResult
  replaceResearchSeed(request: ContextBankResearchSeedWriteRequest): ContextBankResearchStatusResult
  searchResearch(request: ContextBankResearchSearchRequest): ContextBankResearchSearchResult
  putResearchPrior(request: ContextBankResearchPriorWriteRequest): ContextBankResearchPriorWriteResult
}

export { contextBankPath, copyContextBankForSaveAs }

/** Clears only Context Bank state. The canonical .lumen document and source media are untouched. */
export function clearContextBank(projectPath: string, projectId: string) {
  const status = clearCoreContextBank(projectPath, projectId)
  clearShowResearch(contextBankPath(projectPath, projectId))
  return status
}

/**
 * Opens the durable Context Bank and composes reusable source-analysis and
 * show-research methods around the core timeline/transcript store.
 */
export function openContextBank(projectPath: string, projectId: string): ContextBankStore {
  const store = openCoreContextBank(projectPath, projectId) as ContextBankStore
  const databasePath = contextBankPath(projectPath, projectId)

  store.putObservations = (request: ContextBankObservationWriteRequest): ContextBankObservationResult =>
    putSourceObservations(databasePath, projectPath, projectId, request)
  store.getObservations = (request: ContextBankObservationQuery): ContextBankObservationResult =>
    getSourceObservations(databasePath, projectPath, projectId, request)

  store.getResearchStatus = (request: ContextBankResearchStatusRequest): ContextBankResearchStatusResult =>
    getShowResearchStatus(databasePath, projectPath, projectId, request)
  store.setResearchState = (request: ContextBankResearchStateWriteRequest): ContextBankResearchStatusResult =>
    setShowResearchState(databasePath, projectPath, projectId, request)
  store.replaceResearchSeed = (request: ContextBankResearchSeedWriteRequest): ContextBankResearchStatusResult =>
    replaceShowResearchSeed(databasePath, projectPath, projectId, request)
  store.searchResearch = (request: ContextBankResearchSearchRequest): ContextBankResearchSearchResult =>
    searchShowResearch(databasePath, projectPath, projectId, request)
  store.putResearchPrior = (request: ContextBankResearchPriorWriteRequest): ContextBankResearchPriorWriteResult =>
    putShowResearchPrior(databasePath, projectPath, projectId, request)

  const clearCore = store.clear.bind(store)
  store.clear = () => {
    const result = clearCore()
    clearShowResearch(databasePath)
    return result
  }

  return store
}

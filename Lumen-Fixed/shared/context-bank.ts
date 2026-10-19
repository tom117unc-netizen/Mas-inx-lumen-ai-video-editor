import type {
  ContextBankObservationQuery,
  ContextBankObservationResult,
  ContextBankObservationWriteRequest,
  ContextBankTranscriptQuery,
  ContextBankTranscriptResult,
  ContextBankTranscriptWriteRequest,
} from './context-bank-analysis'
import type {
  ContextBankResearchPriorWriteRequest,
  ContextBankResearchPriorWriteResult,
  ContextBankResearchSearchRequest,
  ContextBankResearchSearchResult,
  ContextBankResearchSeedWriteRequest,
  ContextBankResearchStateWriteRequest,
  ContextBankResearchStatusRequest,
  ContextBankResearchStatusResult,
} from './context-bank-research'

export const CONTEXT_BANK_MIRROR_FORMAT = 'lumen-context-mirror' as const
export const CONTEXT_BANK_MIRROR_VERSION = 1 as const

export type ContextBankAssetKind = 'video' | 'image' | 'audio'
export type ContextBankClipKind = 'video' | 'image' | 'audio' | 'text' | 'adjustment'
export type ContextBankMutationKind = 'dispatch' | 'transaction' | 'undo' | 'redo' | 'load'
export type ContextBankActionSource = 'user' | 'ai'

/** File-backed media identity only; runtime URLs and heavy derived arrays never cross this boundary. */
export interface ContextBankAssetMirror {
  id: string
  name: string
  kind: ContextBankAssetKind
  duration?: number
  width?: number
  height?: number
  fps?: number
  hasAudio?: boolean
  path: string
  fileName: string
  mime: string
  size: number
  mtime?: number
  missing: boolean
}

export interface ContextBankClipMirror {
  sequenceId: string
  clipId: string
  trackId: string
  name: string
  kind: ContextBankClipKind
  start: number
  duration: number
  assetId?: string
  inPoint: number
  speed: number
  reverse: boolean
  freeze: boolean
  hasSpeedRamp: boolean
  nestedSequenceId?: string
}

export interface ContextBankMarkerMirror {
  sequenceId: string
  markerId: string
  frame: number
  label: string
  color: string
}

export interface ContextBankSequenceMirror {
  id: string
  name: string
  fps: number
  clips: ContextBankClipMirror[]
  markers: ContextBankMarkerMirror[]
}

export interface ContextBankMirror {
  format: typeof CONTEXT_BANK_MIRROR_FORMAT
  version: typeof CONTEXT_BANK_MIRROR_VERSION
  projectId: string
  projectName: string
  revision: number
  assets: ContextBankAssetMirror[]
  sequences: ContextBankSequenceMirror[]
}

export interface ContextBankMutation {
  kind: ContextBankMutationKind
  revision: number
  historyId?: number
  label?: string
  source?: ContextBankActionSource
  at: number
}

export interface ContextBankSyncRequest {
  projectPath: string
  mirror: ContextBankMirror
  mutation?: ContextBankMutation
}

export interface ContextBankStatus {
  available: boolean
  projectId: string
  projectPath: string
  databasePath?: string
  schemaVersion: number
  revision: number
  assetCount: number
  clipCount: number
  markerCount: number
  editEventCount: number
  warnings: string[]
}

export interface ContextBankQuery {
  projectPath: string
  projectId: string
  sequenceId?: string
  startFrame?: number
  endFrame?: number
  purpose: string
  maxItems: number
  maxCharacters: number
}

export interface ContextBankQueryClip {
  sequenceId: string
  clipId: string
  trackId: string
  name: string
  kind: ContextBankClipKind
  start: number
  duration: number
  assetId?: string
  inPoint: number
  speed: number
  reverse: boolean
  freeze: boolean
  hasSpeedRamp: boolean
}

export interface ContextBankQueryMarker {
  sequenceId: string
  markerId: string
  frame: number
  label: string
  color: string
}

export interface ContextBankQuerySource {
  assetId: string
  name: string
  kind: ContextBankAssetKind
  path: string
  size: number
  mtime?: number
  fingerprint?: string
  missing: boolean
}

export interface ContextBankQueryEdit {
  operationId: string
  revision: number
  kind: ContextBankMutationKind
  historyId?: number
  label?: string
  source?: ContextBankActionSource
  at: number
}

export interface ContextBankQueryResult {
  projectId: string
  revision: number
  clips: ContextBankQueryClip[]
  markers: ContextBankQueryMarker[]
  sources: ContextBankQuerySource[]
  edits: ContextBankQueryEdit[]
  truncated: boolean
  warnings: string[]
}

export interface ContextBankAPI {
  sync(request: ContextBankSyncRequest): Promise<ContextBankStatus>
  query(request: ContextBankQuery): Promise<ContextBankQueryResult>
  putTranscript(request: ContextBankTranscriptWriteRequest): Promise<ContextBankTranscriptResult>
  getTranscript(query: ContextBankTranscriptQuery): Promise<ContextBankTranscriptResult>
  putObservations(request: ContextBankObservationWriteRequest): Promise<ContextBankObservationResult>
  getObservations(query: ContextBankObservationQuery): Promise<ContextBankObservationResult>
  getResearchStatus(request: ContextBankResearchStatusRequest): Promise<ContextBankResearchStatusResult>
  setResearchState(request: ContextBankResearchStateWriteRequest): Promise<ContextBankResearchStatusResult>
  replaceResearchSeed(request: ContextBankResearchSeedWriteRequest): Promise<ContextBankResearchStatusResult>
  searchResearch(request: ContextBankResearchSearchRequest): Promise<ContextBankResearchSearchResult>
  putResearchPrior(request: ContextBankResearchPriorWriteRequest): Promise<ContextBankResearchPriorWriteResult>
  status(projectPath: string, projectId: string): Promise<ContextBankStatus>
  copyForSaveAs(projectId: string, fromProjectPath: string, toProjectPath: string): Promise<void>
  clear(projectPath: string, projectId: string): Promise<void>
}

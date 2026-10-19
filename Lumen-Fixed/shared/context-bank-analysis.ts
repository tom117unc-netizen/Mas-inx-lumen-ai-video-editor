export const CONTEXT_BANK_ANALYSIS_VERSION_MAX = 128
export const CONTEXT_BANK_TRANSCRIPT_TEXT_MAX = 10_000
export const CONTEXT_BANK_OBSERVATION_TEXT_MAX = 20_000
export const CONTEXT_BANK_PROVENANCE_STRING_MAX = 1_000
export const CONTEXT_BANK_PROVENANCE_KEYS_MAX = 32
export const CONTEXT_BANK_PROVENANCE_KEY_MAX = 128

export type ContextBankPrimitive = string | number | boolean

export interface ContextBankTranscriptWord {
  start: number
  end: number
  text: string
}

export interface ContextBankTranscriptSegment {
  start: number
  end: number
  text: string
}

export interface ContextBankTranscriptWriteRequest {
  projectPath: string
  projectId: string
  assetId: string
  provider: string
  model: string
  language?: string
  analysisVersion: string
  words: ContextBankTranscriptWord[]
  segments: ContextBankTranscriptSegment[]
  createdAt: number
}

export interface ContextBankTranscriptQuery {
  projectPath: string
  projectId: string
  assetId: string
  startSeconds?: number
  endSeconds?: number
  maxWords: number
  maxSegments: number
  maxCharacters: number
}

export interface ContextBankTranscriptResult {
  projectId: string
  assetId: string
  fingerprint: string
  found: boolean
  provider?: string
  model?: string
  language?: string
  analysisVersion?: string
  createdAt?: number
  words: ContextBankTranscriptWord[]
  segments: ContextBankTranscriptSegment[]
  truncated: boolean
  warnings: string[]
}

export interface ContextBankObservationProvenance {
  producer: string
  model?: string
  source?: string
  createdAt: number
  metadata?: Record<string, ContextBankPrimitive>
}

export interface ContextBankObservationInput {
  id: string
  kind: string
  start: number
  end: number
  text: string
  confidence?: number
  provenance: ContextBankObservationProvenance
  analysisVersion: string
}

export interface ContextBankObservationWriteRequest {
  projectPath: string
  projectId: string
  assetId: string
  observations: ContextBankObservationInput[]
}

export interface ContextBankObservationQuery {
  projectPath: string
  projectId: string
  assetId: string
  startSeconds?: number
  endSeconds?: number
  kind?: string
  maxItems: number
  maxCharacters: number
}

export interface ContextBankObservationResult {
  projectId: string
  assetId: string
  fingerprint: string
  observations: ContextBankObservationInput[]
  truncated: boolean
  warnings: string[]
}

function boundedString(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  if (value.length > max) throw new Error(`${label} is too long`)
}

export function validateAnalysisVersion(value: string) {
  boundedString(value, 'analysis version', CONTEXT_BANK_ANALYSIS_VERSION_MAX)
}

export function validateSourceRange(start?: number, end?: number) {
  for (const [label, value] of [['start', start], ['end', end]] as const) {
    if (value === undefined) continue
    if (!Number.isFinite(value)) throw new Error(`${label} must be finite`)
    if (value < 0) throw new Error(`${label} must be non-negative`)
  }
  if (start !== undefined && end !== undefined && end <= start) throw new Error('end must be after start')
}

export function validateTranscriptItems(items: readonly ContextBankTranscriptWord[]) {
  let previousStart = -1
  for (const item of items) {
    if (!Number.isFinite(item.start) || !Number.isFinite(item.end)) throw new Error('Transcript timing must be finite')
    if (item.start < 0 || item.end < 0) throw new Error('Transcript timing must be non-negative')
    if (item.end < item.start) throw new Error('Transcript item end must not be before start')
    if (item.start < previousStart) throw new Error('Transcript timing must be monotonic')
    boundedString(item.text, 'Transcript text', CONTEXT_BANK_TRANSCRIPT_TEXT_MAX)
    previousStart = item.start
  }
}

export function validateObservationInput(input: ContextBankObservationInput) {
  boundedString(input.id, 'Observation id', 256)
  boundedString(input.kind, 'Observation kind', 128)
  validateSourceRange(input.start, input.end)
  boundedString(input.text, 'Observation text', CONTEXT_BANK_OBSERVATION_TEXT_MAX)
  validateAnalysisVersion(input.analysisVersion)
  if (input.confidence !== undefined && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
    throw new Error('Observation confidence must be between 0 and 1')
  }

  const provenance = input.provenance
  boundedString(provenance.producer, 'Observation provenance producer', CONTEXT_BANK_PROVENANCE_STRING_MAX)
  if (provenance.model !== undefined) boundedString(provenance.model, 'Observation provenance model', CONTEXT_BANK_PROVENANCE_STRING_MAX)
  if (provenance.source !== undefined) boundedString(provenance.source, 'Observation provenance source', CONTEXT_BANK_PROVENANCE_STRING_MAX)
  if (!Number.isFinite(provenance.createdAt) || provenance.createdAt < 0) throw new Error('Observation provenance createdAt must be a non-negative finite number')

  const entries = Object.entries(provenance.metadata ?? {})
  if (entries.length > CONTEXT_BANK_PROVENANCE_KEYS_MAX) throw new Error('Observation provenance has too many metadata fields')
  for (const [key, value] of entries) {
    boundedString(key, 'Observation provenance metadata key', CONTEXT_BANK_PROVENANCE_KEY_MAX)
    if (typeof value === 'string') {
      if (value.length > CONTEXT_BANK_PROVENANCE_STRING_MAX) throw new Error('Observation provenance metadata string is too long')
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Observation provenance metadata numbers must be finite')
    } else if (typeof value !== 'boolean') {
      throw new Error('Observation provenance metadata values must be primitive JSON')
    }
  }
}

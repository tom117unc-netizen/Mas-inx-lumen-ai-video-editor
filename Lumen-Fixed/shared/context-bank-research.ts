export const CONTEXT_BANK_RESEARCH_ID_MAX = 256
export const CONTEXT_BANK_RESEARCH_TITLE_MAX = 500
export const CONTEXT_BANK_RESEARCH_QUERY_MAX = 1_000
export const CONTEXT_BANK_RESEARCH_PRIOR_TEXT_MAX = 4_000
export const CONTEXT_BANK_RESEARCH_SOURCE_TEXT_MAX = 30_000
export const CONTEXT_BANK_RESEARCH_CHUNK_TEXT_MAX = 6_000
export const CONTEXT_BANK_RESEARCH_EVIDENCE_EXCERPT_MAX = 1_500
export const CONTEXT_BANK_RESEARCH_ANALYSIS_VERSION_MAX = 128
export const CONTEXT_BANK_RESEARCH_SEED_SOURCES_MAX = 8
export const CONTEXT_BANK_RESEARCH_SEED_CHUNKS_MAX = 256
export const CONTEXT_BANK_RESEARCH_CANDIDATES_MAX = 12
export const CONTEXT_BANK_RESEARCH_SEARCH_ITEMS_MAX = 20
export const CONTEXT_BANK_RESEARCH_SEARCH_CHARACTERS_MAX = 20_000
export const CONTEXT_BANK_RESEARCH_EPISODE_MAX = 10_000

export type ContextBankResearchStatus =
  | 'not-started'
  | 'resolving'
  | 'needs-confirmation'
  | 'seeding'
  | 'ready'
  | 'error'

export type ContextBankResearchPositionHint = 'early' | 'middle' | 'late' | 'unknown'

export interface ContextBankResearchIdentity {
  source: 'anilist'
  externalId: string
  canonicalTitle: string
  year?: number
  format?: string
  episodes?: number
}

export interface ContextBankResearchIdentityCandidate extends ContextBankResearchIdentity {
  aliases: string[]
  score: number
}

export interface ContextBankResearchState {
  showQuery: string
  status: ContextBankResearchStatus
  identity?: ContextBankResearchIdentity
  candidates?: ContextBankResearchIdentityCandidate[]
  error?: string
  updatedAt: number
}

export interface ContextBankResearchSource {
  id: string
  url: string
  title?: string
  site?: string
  retrievedAt: number
  contentHash: string
  text: string
}

export interface ContextBankResearchChunk {
  id: string
  sourceId: string
  ordinal: number
  heading?: string
  text: string
  /** Present only when the source text explicitly labels an episode. */
  episodeNumber?: number
}

export interface ContextBankResearchEvidence {
  sourceId: string
  chunkId: string
  excerpt: string
}

export interface ContextBankResearchPriorProvenance {
  producer: string
  analysisVersion: string
  createdAt: number
}

/**
 * A web-backed search prior. This type intentionally has no source-media
 * timestamps: research may suggest where to look, but imported footage must
 * establish exact source time through verified observations.
 */
export interface ContextBankResearchPrior {
  id: string
  query: string
  text: string
  episodeNumber?: number
  positionHint?: ContextBankResearchPositionHint
  confidence: number
  evidence: ContextBankResearchEvidence
  provenance: ContextBankResearchPriorProvenance
}

export interface ContextBankResearchStatusRequest {
  projectPath: string
  projectId: string
}

export interface ContextBankResearchStatusResult {
  projectId: string
  state?: ContextBankResearchState
  sourceCount: number
  chunkCount: number
  priorCount: number
  warnings: string[]
}

export interface ContextBankResearchStateWriteRequest extends ContextBankResearchStatusRequest {
  state: ContextBankResearchState
}

/** Replaces the currently cached bounded source/chunk pack atomically. */
export interface ContextBankResearchSeedWriteRequest extends ContextBankResearchStatusRequest {
  state: ContextBankResearchState
  sources: ContextBankResearchSource[]
  chunks: ContextBankResearchChunk[]
}

export interface ContextBankResearchSearchRequest extends ContextBankResearchStatusRequest {
  query: string
  maxItems: number
  maxCharacters: number
}

export interface ContextBankResearchChunkHit extends ContextBankResearchChunk {
  sourceUrl: string
  sourceTitle?: string
  site?: string
  score: number
}

export interface ContextBankResearchSearchResult {
  projectId: string
  priors: ContextBankResearchPrior[]
  chunks: ContextBankResearchChunkHit[]
  truncated: boolean
  warnings: string[]
}

export interface ContextBankResearchPriorWriteRequest extends ContextBankResearchStatusRequest {
  prior: ContextBankResearchPrior
}

export interface ContextBankResearchPriorWriteResult {
  projectId: string
  prior: ContextBankResearchPrior
  created: boolean
  warnings: string[]
}

function boundedString(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  if (value.length > max) throw new Error(`${label} is too long`)
}

function optionalBoundedString(value: unknown, label: string, max: number) {
  if (value === undefined) return
  boundedString(value, label, max)
}

function finiteNonNegative(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`)
  }
}

function positiveInteger(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${label} must be a positive integer no greater than ${max}`)
  }
}

function assertOnlyFields(value: object, allowed: readonly string[], label: string) {
  const allowedSet = new Set(allowed)
  const unsupported = Object.keys(value).find((key) => !allowedSet.has(key))
  if (unsupported) throw new Error(`${label} has unsupported field: ${unsupported}`)
}

export function validateResearchIdentity(identity: ContextBankResearchIdentity) {
  assertOnlyFields(identity, ['source', 'externalId', 'canonicalTitle', 'year', 'format', 'episodes'], 'Research identity')
  if (identity.source !== 'anilist') throw new Error('Research identity source is unsupported')
  boundedString(identity.externalId, 'Research identity external id', CONTEXT_BANK_RESEARCH_ID_MAX)
  boundedString(identity.canonicalTitle, 'Research identity canonical title', CONTEXT_BANK_RESEARCH_TITLE_MAX)
  if (identity.year !== undefined && (!Number.isInteger(identity.year) || identity.year < 1900 || identity.year > 2200)) {
    throw new Error('Research identity year is invalid')
  }
  optionalBoundedString(identity.format, 'Research identity format', 128)
  if (identity.episodes !== undefined) positiveInteger(identity.episodes, 'Research identity episodes', CONTEXT_BANK_RESEARCH_EPISODE_MAX)
}

export function validateResearchState(state: ContextBankResearchState) {
  assertOnlyFields(state, ['showQuery', 'status', 'identity', 'candidates', 'error', 'updatedAt'], 'Research state')
  boundedString(state.showQuery, 'Research show query', CONTEXT_BANK_RESEARCH_QUERY_MAX)
  const statuses: readonly ContextBankResearchStatus[] = ['not-started', 'resolving', 'needs-confirmation', 'seeding', 'ready', 'error']
  if (!statuses.includes(state.status)) throw new Error('Research status is invalid')
  if (state.identity) validateResearchIdentity(state.identity)
  if (state.candidates) {
    if (state.candidates.length > CONTEXT_BANK_RESEARCH_CANDIDATES_MAX) throw new Error('Research state has too many identity candidates')
    for (const candidate of state.candidates) {
      assertOnlyFields(candidate, ['source', 'externalId', 'canonicalTitle', 'year', 'format', 'episodes', 'aliases', 'score'], 'Research identity candidate')
      validateResearchIdentity({
        source: candidate.source,
        externalId: candidate.externalId,
        canonicalTitle: candidate.canonicalTitle,
        year: candidate.year,
        format: candidate.format,
        episodes: candidate.episodes,
      })
      if (!Array.isArray(candidate.aliases) || candidate.aliases.length > 24) throw new Error('Research identity candidate aliases are invalid')
      for (const alias of candidate.aliases) boundedString(alias, 'Research identity alias', CONTEXT_BANK_RESEARCH_TITLE_MAX)
      if (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1) throw new Error('Research identity candidate score must be between 0 and 1')
    }
  }
  optionalBoundedString(state.error, 'Research error', 2_000)
  finiteNonNegative(state.updatedAt, 'Research updatedAt')
}

export function validateResearchSource(source: ContextBankResearchSource) {
  assertOnlyFields(source, ['id', 'url', 'title', 'site', 'retrievedAt', 'contentHash', 'text'], 'Research source')
  boundedString(source.id, 'Research source id', CONTEXT_BANK_RESEARCH_ID_MAX)
  validatePublicResearchUrl(source.url)
  optionalBoundedString(source.title, 'Research source title', CONTEXT_BANK_RESEARCH_TITLE_MAX)
  optionalBoundedString(source.site, 'Research source site', 256)
  finiteNonNegative(source.retrievedAt, 'Research source retrievedAt')
  boundedString(source.contentHash, 'Research source content hash', 256)
  boundedString(source.text, 'Research source text', CONTEXT_BANK_RESEARCH_SOURCE_TEXT_MAX)
}

export function validateResearchChunk(chunk: ContextBankResearchChunk) {
  assertOnlyFields(chunk, ['id', 'sourceId', 'ordinal', 'heading', 'text', 'episodeNumber'], 'Research chunk')
  boundedString(chunk.id, 'Research chunk id', CONTEXT_BANK_RESEARCH_ID_MAX)
  boundedString(chunk.sourceId, 'Research chunk source id', CONTEXT_BANK_RESEARCH_ID_MAX)
  if (!Number.isInteger(chunk.ordinal) || chunk.ordinal < 0) throw new Error('Research chunk ordinal must be a non-negative integer')
  optionalBoundedString(chunk.heading, 'Research chunk heading', CONTEXT_BANK_RESEARCH_TITLE_MAX)
  boundedString(chunk.text, 'Research chunk text', CONTEXT_BANK_RESEARCH_CHUNK_TEXT_MAX)
  if (chunk.episodeNumber !== undefined) positiveInteger(chunk.episodeNumber, 'Research chunk episode number', CONTEXT_BANK_RESEARCH_EPISODE_MAX)
}

export function validateResearchPrior(input: ContextBankResearchPrior) {
  assertOnlyFields(input, ['id', 'query', 'text', 'episodeNumber', 'positionHint', 'confidence', 'evidence', 'provenance'], 'Research prior')
  boundedString(input.id, 'Research prior id', CONTEXT_BANK_RESEARCH_ID_MAX)
  boundedString(input.query, 'Research prior query', CONTEXT_BANK_RESEARCH_QUERY_MAX)
  boundedString(input.text, 'Research prior text', CONTEXT_BANK_RESEARCH_PRIOR_TEXT_MAX)
  if (input.episodeNumber !== undefined) positiveInteger(input.episodeNumber, 'Research prior episode number', CONTEXT_BANK_RESEARCH_EPISODE_MAX)
  if (input.positionHint !== undefined && !(['early', 'middle', 'late', 'unknown'] as const).includes(input.positionHint)) {
    throw new Error('Research prior position hint is invalid')
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new Error('Research prior confidence must be between 0 and 1')
  }

  assertOnlyFields(input.evidence, ['sourceId', 'chunkId', 'excerpt'], 'Research prior evidence')
  boundedString(input.evidence.sourceId, 'Research prior evidence source id', CONTEXT_BANK_RESEARCH_ID_MAX)
  boundedString(input.evidence.chunkId, 'Research prior evidence chunk id', CONTEXT_BANK_RESEARCH_ID_MAX)
  boundedString(input.evidence.excerpt, 'Research prior evidence excerpt', CONTEXT_BANK_RESEARCH_EVIDENCE_EXCERPT_MAX)

  assertOnlyFields(input.provenance, ['producer', 'analysisVersion', 'createdAt'], 'Research prior provenance')
  boundedString(input.provenance.producer, 'Research prior provenance producer', 256)
  if (input.provenance.producer.trim().toLowerCase() === 'verified-media') {
    throw new Error('Research prior provenance cannot be verified-media')
  }
  boundedString(input.provenance.analysisVersion, 'Research prior analysis version', CONTEXT_BANK_RESEARCH_ANALYSIS_VERSION_MAX)
  finiteNonNegative(input.provenance.createdAt, 'Research prior provenance createdAt')
}

export function validateResearchSearchRequest(request: ContextBankResearchSearchRequest) {
  boundedString(request.projectPath, 'Research project path', 4_096)
  boundedString(request.projectId, 'Research project id', CONTEXT_BANK_RESEARCH_ID_MAX)
  boundedString(request.query, 'Research search query', CONTEXT_BANK_RESEARCH_QUERY_MAX)
  if (!Number.isInteger(request.maxItems) || request.maxItems < 1 || request.maxItems > CONTEXT_BANK_RESEARCH_SEARCH_ITEMS_MAX) {
    throw new Error(`Research maxItems must be between 1 and ${CONTEXT_BANK_RESEARCH_SEARCH_ITEMS_MAX}`)
  }
  if (!Number.isInteger(request.maxCharacters) || request.maxCharacters < 1 || request.maxCharacters > CONTEXT_BANK_RESEARCH_SEARCH_CHARACTERS_MAX) {
    throw new Error(`Research maxCharacters must be between 1 and ${CONTEXT_BANK_RESEARCH_SEARCH_CHARACTERS_MAX}`)
  }
}

export function validateResearchStateWriteRequest(request: ContextBankResearchStateWriteRequest) {
  boundedString(request.projectPath, 'Research project path', 4_096)
  boundedString(request.projectId, 'Research project id', CONTEXT_BANK_RESEARCH_ID_MAX)
  validateResearchState(request.state)
}

export function validateResearchSeedWriteRequest(request: ContextBankResearchSeedWriteRequest) {
  validateResearchStateWriteRequest(request)
  if (request.sources.length > CONTEXT_BANK_RESEARCH_SEED_SOURCES_MAX) throw new Error('Research seed has too many sources')
  if (request.chunks.length > CONTEXT_BANK_RESEARCH_SEED_CHUNKS_MAX) throw new Error('Research seed has too many chunks')
  for (const source of request.sources) validateResearchSource(source)
  const sourceIds = new Set(request.sources.map((source) => source.id))
  for (const chunk of request.chunks) {
    validateResearchChunk(chunk)
    if (!sourceIds.has(chunk.sourceId)) throw new Error(`Research chunk references unknown source: ${chunk.sourceId}`)
  }
}

function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return null
  const numbers = parts.map(Number)
  if (numbers.some((part) => part < 0 || part > 255)) return null
  return numbers
}

function isPublicIpv4(parts: readonly number[]) {
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && (b === 0 || b === 168)) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  return true
}

/**
 * Syntactic main-process boundary check for research URLs. The actual fetcher
 * must still apply its own redirect/DNS policy before making a request.
 */
export function validatePublicResearchUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Research URL must be a valid public http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Research URL must use http or https')
  if (url.username || url.password) throw new Error('Research URL must not contain credentials')
  const hostname = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Research URL must use a public host')
  }
  const ipv4 = parseIpv4(hostname)
  if (ipv4 && !isPublicIpv4(ipv4)) throw new Error('Research URL must use a public host')
  if (hostname.includes(':')) {
    if (hostname === '::' || hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd') || /^fe[89ab]/.test(hostname)) {
      throw new Error('Research URL must use a public host')
    }
  } else if (!ipv4 && !hostname.includes('.')) {
    throw new Error('Research URL must use a public host')
  }
  return url.toString()
}

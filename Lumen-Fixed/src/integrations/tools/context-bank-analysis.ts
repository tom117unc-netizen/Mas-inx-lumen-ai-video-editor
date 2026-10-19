import type {
  ContextBankObservationQuery,
  ContextBankObservationWriteRequest,
  ContextBankTranscriptQuery,
} from '@shared/context-bank-analysis'
import { getProject } from '@/editor/store'
import { desktop } from '@/lib/platform'
import { flushContextBankWrites } from '@/project/context-bank-runtime'
import { useSession } from '@/project/session'
import { int, num, obj, str, type AgentTool, type ToolArgs } from './kit'

export const DEFAULT_SOURCE_TRANSCRIPT_WORDS = 180
export const MAX_SOURCE_TRANSCRIPT_WORDS = 500
export const DEFAULT_SOURCE_TRANSCRIPT_SEGMENTS = 60
export const MAX_SOURCE_TRANSCRIPT_SEGMENTS = 200
export const DEFAULT_SOURCE_TRANSCRIPT_CHARACTERS = 12_000
export const MAX_SOURCE_TRANSCRIPT_CHARACTERS = 28_000

export const DEFAULT_SOURCE_OBSERVATION_ITEMS = 80
export const MAX_SOURCE_OBSERVATION_ITEMS = 200
export const DEFAULT_SOURCE_OBSERVATION_CHARACTERS = 12_000
export const MAX_SOURCE_OBSERVATION_CHARACTERS = 28_000

const OBSERVATION_ANALYSIS_VERSION = 'ai-source-observation-v1'
const OBSERVATION_PRODUCER = 'anime-review-ai'

function requiredText(args: ToolArgs, key: string, label: string, max: number) {
  const value = typeof args[key] === 'string' ? args[key].trim() : ''
  if (!value) throw new Error(`${label} is required`)
  if (value.length > max) throw new Error(`${label} is too long`)
  return value
}

function optionalText(args: ToolArgs, key: string, label: string, max: number) {
  if (args[key] === undefined || args[key] === null) return undefined
  const value = typeof args[key] === 'string' ? args[key].trim() : ''
  if (!value) throw new Error(`${label} must be a non-empty string`)
  if (value.length > max) throw new Error(`${label} is too long`)
  return value
}

function optionalSecond(args: ToolArgs, key: 'start_seconds' | 'end_seconds') {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${key} must be a non-negative finite number`)
  return value
}

function requiredSecond(args: ToolArgs, key: 'start_seconds' | 'end_seconds') {
  const value = optionalSecond(args, key)
  if (value === undefined) throw new Error(`${key} is required`)
  return value
}

function sourceRange(args: ToolArgs) {
  const startSeconds = optionalSecond(args, 'start_seconds')
  const endSeconds = optionalSecond(args, 'end_seconds')
  if (startSeconds !== undefined && endSeconds !== undefined && endSeconds <= startSeconds) {
    throw new Error('end_seconds must be after start_seconds')
  }
  return { startSeconds, endSeconds }
}

function requiredSourceRange(args: ToolArgs) {
  const start = requiredSecond(args, 'start_seconds')
  const end = requiredSecond(args, 'end_seconds')
  if (end <= start) throw new Error('end_seconds must be after start_seconds')
  return { start, end }
}

function budget(args: ToolArgs, key: string, fallback: number, min: number, max: number) {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a number`)
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function requireProject(projectPath: string | null, projectId: string) {
  if (!projectPath) throw new Error('Save the project before using reusable source analysis.')
  if (!projectId.trim()) throw new Error('Project id is required')
  return { projectPath, projectId }
}

function validatePurpose(args: ToolArgs) {
  return requiredText(args, 'purpose', 'A focused retrieval purpose', 500)
}

/** 64-bit FNV-1a: compact and deterministic so retries upsert the same observation. */
function stableHash64(value: string) {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

export function makeSourceTranscriptQuery(args: ToolArgs, projectPath: string | null, projectId: string): ContextBankTranscriptQuery {
  const project = requireProject(projectPath, projectId)
  const assetId = requiredText(args, 'asset_id', 'Asset id', 256)
  validatePurpose(args)
  const { startSeconds, endSeconds } = sourceRange(args)
  return {
    ...project,
    assetId,
    ...(startSeconds === undefined ? {} : { startSeconds }),
    ...(endSeconds === undefined ? {} : { endSeconds }),
    maxWords: budget(args, 'max_words', DEFAULT_SOURCE_TRANSCRIPT_WORDS, 1, MAX_SOURCE_TRANSCRIPT_WORDS),
    maxSegments: budget(args, 'max_segments', DEFAULT_SOURCE_TRANSCRIPT_SEGMENTS, 1, MAX_SOURCE_TRANSCRIPT_SEGMENTS),
    maxCharacters: budget(args, 'max_characters', DEFAULT_SOURCE_TRANSCRIPT_CHARACTERS, 500, MAX_SOURCE_TRANSCRIPT_CHARACTERS),
  }
}

export function makeSourceObservationQuery(args: ToolArgs, projectPath: string | null, projectId: string): ContextBankObservationQuery {
  const project = requireProject(projectPath, projectId)
  const assetId = requiredText(args, 'asset_id', 'Asset id', 256)
  validatePurpose(args)
  const kind = optionalText(args, 'kind', 'Observation kind', 128)
  const { startSeconds, endSeconds } = sourceRange(args)
  return {
    ...project,
    assetId,
    ...(startSeconds === undefined ? {} : { startSeconds }),
    ...(endSeconds === undefined ? {} : { endSeconds }),
    ...(kind ? { kind } : {}),
    maxItems: budget(args, 'max_items', DEFAULT_SOURCE_OBSERVATION_ITEMS, 1, MAX_SOURCE_OBSERVATION_ITEMS),
    maxCharacters: budget(args, 'max_characters', DEFAULT_SOURCE_OBSERVATION_CHARACTERS, 500, MAX_SOURCE_OBSERVATION_CHARACTERS),
  }
}

export function makeSourceObservationWrite(
  args: ToolArgs,
  projectPath: string | null,
  projectId: string,
  createdAt = Date.now(),
): ContextBankObservationWriteRequest {
  const project = requireProject(projectPath, projectId)
  const assetId = requiredText(args, 'asset_id', 'Asset id', 256)
  const kind = requiredText(args, 'kind', 'Observation kind', 128)
  const text = requiredText(args, 'text', 'Observation text', 4_000)
  const provenanceSource = requiredText(args, 'provenance_source', 'Provenance source', 500)
  const { start, end } = requiredSourceRange(args)
  const confidence = args.confidence
  if (confidence !== undefined && confidence !== null && (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new Error('confidence must be between 0 and 1')
  }
  if (!Number.isFinite(createdAt) || createdAt < 0) throw new Error('createdAt must be a non-negative finite number')

  const identity = JSON.stringify([assetId, kind, start, end, text, provenanceSource])
  return {
    ...project,
    assetId,
    observations: [{
      id: `ai-source-${stableHash64(identity)}`,
      kind,
      start,
      end,
      text,
      ...(typeof confidence === 'number' ? { confidence } : {}),
      provenance: {
        producer: OBSERVATION_PRODUCER,
        source: provenanceSource,
        createdAt: Math.floor(createdAt),
      },
      analysisVersion: OBSERVATION_ANALYSIS_VERSION,
    }],
  }
}

function currentIdentity() {
  return { projectPath: useSession.getState().path, projectId: getProject().id }
}

function ensureSameProject(before: ReturnType<typeof currentIdentity>) {
  const after = currentIdentity()
  if (after.projectPath !== before.projectPath || after.projectId !== before.projectId) {
    throw new Error('The project changed while Context Bank synchronization was finishing; retry the source-analysis request.')
  }
}

async function barrier() {
  if (!desktop) throw new Error('Reusable source analysis needs the Lumen desktop app.')
  await flushContextBankWrites()
  return desktop
}

export const CONTEXT_BANK_ANALYSIS_TOOLS: AgentTool[] = [
  {
    name: 'get_source_transcript',
    description: 'Read a bounded source-time slice of a transcript Lumen has already cached for one imported asset. Use this for exact narration words/timings without retranscribing media. This never starts transcription or media analysis.',
    inputSchema: obj({
      asset_id: str('Exact imported asset ID whose cached transcript should be read.'),
      purpose: str('The specific decision this transcript is for. Required so retrieval stays narrow.'),
      start_seconds: num('Optional inclusive source-media start time in seconds.', { minimum: 0 }),
      end_seconds: num('Optional exclusive source-media end time in seconds; must be after start_seconds.', { minimum: 0 }),
      max_words: int(`Optional word budget; hard-capped at ${MAX_SOURCE_TRANSCRIPT_WORDS}.`, { minimum: 1, maximum: MAX_SOURCE_TRANSCRIPT_WORDS }),
      max_segments: int(`Optional phrase/segment budget; hard-capped at ${MAX_SOURCE_TRANSCRIPT_SEGMENTS}.`, { minimum: 1, maximum: MAX_SOURCE_TRANSCRIPT_SEGMENTS }),
      max_characters: int(`Optional serialized result budget; hard-capped at ${MAX_SOURCE_TRANSCRIPT_CHARACTERS}.`, { minimum: 500, maximum: MAX_SOURCE_TRANSCRIPT_CHARACTERS }),
    }, ['asset_id', 'purpose']),
    run: async args => {
      const identity = currentIdentity()
      const request = makeSourceTranscriptQuery(args, identity.projectPath, identity.projectId)
      const app = await barrier()
      ensureSameProject(identity)
      return app.contextBank.getTranscript(request)
    },
  },
  {
    name: 'get_source_observations',
    description: 'Read bounded source-time observations Lumen has already verified or recorded for one imported asset, such as scenes, dialogue, characters or events. This reads cached knowledge only and never invokes vision, web research or media analysis.',
    inputSchema: obj({
      asset_id: str('Exact imported asset ID whose cached source observations should be read.'),
      purpose: str('The specific decision these observations are for. Required so retrieval stays narrow.'),
      start_seconds: num('Optional inclusive source-media start time in seconds.', { minimum: 0 }),
      end_seconds: num('Optional exclusive source-media end time in seconds; must be after start_seconds.', { minimum: 0 }),
      kind: str('Optional observation kind to filter, for example scene, dialogue, character, event or search-miss.'),
      max_items: int(`Optional observation budget; hard-capped at ${MAX_SOURCE_OBSERVATION_ITEMS}.`, { minimum: 1, maximum: MAX_SOURCE_OBSERVATION_ITEMS }),
      max_characters: int(`Optional serialized result budget; hard-capped at ${MAX_SOURCE_OBSERVATION_CHARACTERS}.`, { minimum: 500, maximum: MAX_SOURCE_OBSERVATION_CHARACTERS }),
    }, ['asset_id', 'purpose']),
    run: async args => {
      const identity = currentIdentity()
      const request = makeSourceObservationQuery(args, identity.projectPath, identity.projectId)
      const app = await barrier()
      ensureSameProject(identity)
      return app.contextBank.getObservations(request)
    },
  },
  {
    name: 'record_source_observation',
    description: 'Record one compact observation about an exact source-media time range after the footage has actually been inspected. Use this to remember verified scene knowledge or a useful search result. It does not inspect or analyse media itself.',
    inputSchema: obj({
      asset_id: str('Exact imported asset ID the observation belongs to.'),
      kind: str('Compact observation kind, e.g. scene, dialogue, character, event, search-hit or search-miss.'),
      start_seconds: num('Inclusive source-media start time in seconds.', { minimum: 0 }),
      end_seconds: num('Exclusive source-media end time in seconds; must be after start_seconds.', { minimum: 0 }),
      text: str('Compact factual observation grounded in the inspected source footage.', { maxLength: 4000 }),
      provenance_source: str('What directly supports this observation, e.g. imported episode footage inspected at this range.', { maxLength: 500 }),
      confidence: num('Optional confidence from 0 to 1.', { minimum: 0, maximum: 1 }),
    }, ['asset_id', 'kind', 'start_seconds', 'end_seconds', 'text', 'provenance_source']),
    run: async args => {
      const identity = currentIdentity()
      const request = makeSourceObservationWrite(args, identity.projectPath, identity.projectId)
      const app = await barrier()
      ensureSameProject(identity)
      return app.contextBank.putObservations(request)
    },
  },
]

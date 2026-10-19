import type {
  ContextBankResearchPositionHint,
  ContextBankResearchPrior,
  ContextBankResearchPriorWriteRequest,
  ContextBankResearchSearchRequest,
  ContextBankResearchStatusRequest,
} from '@shared/context-bank-research'
import {
  CONTEXT_BANK_RESEARCH_EPISODE_MAX,
  CONTEXT_BANK_RESEARCH_EVIDENCE_EXCERPT_MAX,
  CONTEXT_BANK_RESEARCH_ID_MAX,
  CONTEXT_BANK_RESEARCH_PRIOR_TEXT_MAX,
  CONTEXT_BANK_RESEARCH_QUERY_MAX,
  CONTEXT_BANK_RESEARCH_SEARCH_CHARACTERS_MAX,
  CONTEXT_BANK_RESEARCH_SEARCH_ITEMS_MAX,
  validateResearchPrior,
} from '@shared/context-bank-research'
import { animeReviewSetupForExistingProject } from '@/editor/anime-review-project'
import { getProject, useEditor } from '@/editor/store'
import { desktop, integrations as desktopIntegrations } from '@/lib/platform'
import { seedAnimeResearchForProject } from '@/project/anime-research'
import { flushContextBankWrites, recordResolvedAnimeResearchIdentity } from '@/project/context-bank-runtime'
import { useSession } from '@/project/session'
import { int, num, obj, oneOf, str, type AgentTool, type ToolArgs } from './kit'

export const DEFAULT_SHOW_RESEARCH_ITEMS = 8
export const MAX_SHOW_RESEARCH_ITEMS = CONTEXT_BANK_RESEARCH_SEARCH_ITEMS_MAX
export const DEFAULT_SHOW_RESEARCH_CHARACTERS = 12_000
export const MAX_SHOW_RESEARCH_CHARACTERS = CONTEXT_BANK_RESEARCH_SEARCH_CHARACTERS_MAX

const RESEARCH_PRIOR_PRODUCER = 'anime-review-ai'
const RESEARCH_PRIOR_ANALYSIS_VERSION = 'ai-research-prior-v1'
const POSITION_HINTS = ['early', 'middle', 'late', 'unknown'] as const satisfies readonly ContextBankResearchPositionHint[]

function requiredText(args: ToolArgs, key: string, label: string, max: number) {
  const value = typeof args[key] === 'string' ? args[key].trim() : ''
  if (!value) throw new Error(`${label} is required`)
  if (value.length > max) throw new Error(`${label} is too long`)
  return value
}

function budget(args: ToolArgs, key: string, fallback: number, max: number) {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a number`)
  return Math.max(1, Math.min(max, Math.floor(value)))
}

function requireResearchProject(projectPath: string | null, projectId: string, showQuery: string | undefined) {
  if (!projectPath) throw new Error('Save the project before using show research.')
  if (!projectId.trim()) throw new Error('Project id is required')
  if (!showQuery?.trim()) throw new Error('An anime-review project with a show query is required for show research.')
  return { projectPath, projectId }
}

function optionalEpisode(args: ToolArgs) {
  const value = args.episode_number
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > CONTEXT_BANK_RESEARCH_EPISODE_MAX) {
    throw new Error(`episode_number must be an integer between 1 and ${CONTEXT_BANK_RESEARCH_EPISODE_MAX}`)
  }
  return value
}

function optionalPositionHint(args: ToolArgs): ContextBankResearchPositionHint | undefined {
  const value = args.position_hint
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || !POSITION_HINTS.includes(value as ContextBankResearchPositionHint)) {
    throw new Error('position_hint must be early, middle, late, or unknown')
  }
  return value as ContextBankResearchPositionHint
}

function requiredConfidence(args: ToolArgs) {
  const value = args.confidence
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('confidence must be between 0 and 1')
  }
  return value
}

/** 64-bit FNV-1a keeps retries idempotent without adding a crypto/browser dependency. */
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

export function makeResearchStatusRequest(
  projectPath: string | null,
  projectId: string,
  showQuery: string | undefined,
): ContextBankResearchStatusRequest {
  return requireResearchProject(projectPath, projectId, showQuery)
}

export function makeResearchSearchRequest(
  args: ToolArgs,
  projectPath: string | null,
  projectId: string,
  showQuery: string | undefined,
): ContextBankResearchSearchRequest {
  const project = requireResearchProject(projectPath, projectId, showQuery)
  return {
    ...project,
    query: requiredText(args, 'query', 'Research query', CONTEXT_BANK_RESEARCH_QUERY_MAX),
    maxItems: budget(args, 'max_items', DEFAULT_SHOW_RESEARCH_ITEMS, MAX_SHOW_RESEARCH_ITEMS),
    maxCharacters: budget(args, 'max_characters', DEFAULT_SHOW_RESEARCH_CHARACTERS, MAX_SHOW_RESEARCH_CHARACTERS),
  }
}

export function makeResearchPriorWrite(
  args: ToolArgs,
  projectPath: string | null,
  projectId: string,
  showQuery: string | undefined,
  createdAt = Date.now(),
): ContextBankResearchPriorWriteRequest {
  const project = requireResearchProject(projectPath, projectId, showQuery)
  if (!Number.isFinite(createdAt) || createdAt < 0) throw new Error('createdAt must be a non-negative finite number')

  const query = requiredText(args, 'query', 'Research prior query', CONTEXT_BANK_RESEARCH_QUERY_MAX)
  const text = requiredText(args, 'text', 'Research prior text', CONTEXT_BANK_RESEARCH_PRIOR_TEXT_MAX)
  const sourceId = requiredText(args, 'source_id', 'Research evidence source id', CONTEXT_BANK_RESEARCH_ID_MAX)
  const chunkId = requiredText(args, 'chunk_id', 'Research evidence chunk id', CONTEXT_BANK_RESEARCH_ID_MAX)
  const excerpt = requiredText(args, 'evidence_excerpt', 'Research evidence excerpt', CONTEXT_BANK_RESEARCH_EVIDENCE_EXCERPT_MAX)
  const episodeNumber = optionalEpisode(args)
  const positionHint = optionalPositionHint(args)
  const confidence = requiredConfidence(args)

  const identity = JSON.stringify([query, text, episodeNumber, positionHint, confidence, sourceId, chunkId, excerpt])
  const prior: ContextBankResearchPrior = {
    id: `research-prior-${stableHash64(identity)}`,
    query,
    text,
    ...(episodeNumber === undefined ? {} : { episodeNumber }),
    ...(positionHint === undefined ? {} : { positionHint }),
    confidence,
    evidence: { sourceId, chunkId, excerpt },
    provenance: {
      producer: RESEARCH_PRIOR_PRODUCER,
      analysisVersion: RESEARCH_PRIOR_ANALYSIS_VERSION,
      createdAt: Math.floor(createdAt),
    },
  }
  validateResearchPrior(prior)
  return { ...project, prior }
}

function currentIdentity() {
  const project = getProject()
  return {
    projectPath: useSession.getState().path,
    projectId: project.id,
    showQuery: project.animeReview?.showQuery,
  }
}

function ensureSameProject(before: ReturnType<typeof currentIdentity>) {
  const after = currentIdentity()
  if (
    after.projectPath !== before.projectPath
    || after.projectId !== before.projectId
    || after.showQuery !== before.showQuery
  ) {
    throw new Error('The project changed while Context Bank synchronization was finishing; retry the show-research request.')
  }
}

async function barrier() {
  if (!desktop) throw new Error('Show research needs the Lumen desktop app.')
  await flushContextBankWrites()
  return desktop
}

export const CONTEXT_BANK_RESEARCH_TOOLS: AgentTool[] = [
  {
    name: 'configure_anime_review_project',
    description: 'Configure an existing saved Lumen project as an anime/show review using an explicit show title, then initialize or refresh its project-local research cache. Never infers the show from the project name. Reusing the same query preserves resolved identity; changing the query drops stale identity and reseeds research for the new show.',
    inputSchema: obj({
      show_query: str('Exact anime/show title to attach to this existing project.', { maxLength: 300 }),
    }, ['show_query']),
    run: async args => {
      const projectPath = useSession.getState().path
      if (!projectPath) throw new Error('Save the project before configuring anime-review research.')
      const showQuery = requiredText(args, 'show_query', 'Show query', 300)
      const state = useEditor.getState()
      const setup = animeReviewSetupForExistingProject(state.project.animeReview, showQuery)
      if (!setup) throw new Error('Show query must be a non-empty title up to 300 characters.')

      const current = state.project.animeReview
      const changed = !current || current.showQuery !== setup.showQuery || current.identity !== setup.identity
      if (changed) {
        useEditor.setState({
          project: { ...state.project, animeReview: setup },
          version: state.version + 1,
        })
      }

      await flushContextBankWrites()
      const project = getProject()
      const research = desktop?.contextBank && desktopIntegrations
        ? await seedAnimeResearchForProject(project, projectPath, {
            bank: desktop.contextBank,
            integrations: desktopIntegrations,
            allowRetry: true,
          })
        : await seedAnimeResearchForProject(project, projectPath)
      recordResolvedAnimeResearchIdentity(project, research)
      return {
        configured: true,
        changed,
        show_query: setup.showQuery,
        research,
      }
    },
  },
  {
    name: 'get_show_research_status',
    description: 'Read the current cached show-research state for this saved anime-review project, including whether identity resolution is ready, ambiguous, or retryable and how much research is cached. Cache-only: this never performs web research.',
    inputSchema: obj({}),
    run: async () => {
      const identity = currentIdentity()
      const request = makeResearchStatusRequest(identity.projectPath, identity.projectId, identity.showQuery)
      const app = await barrier()
      ensureSameProject(identity)
      return app.contextBank.getResearchStatus(request)
    },
  },
  {
    name: 'search_show_research',
    description: 'Search only the bounded show-research evidence and research priors already cached in this project Context Bank. Results are web-backed search priors, not verified source-footage facts or exact media timestamps. This tool never fetches the web.',
    inputSchema: obj({
      query: str('Focused concept, character, event, scene, or episode question to search in the cached research pack.', { maxLength: CONTEXT_BANK_RESEARCH_QUERY_MAX }),
      max_items: int(`Optional result budget; hard-capped at ${MAX_SHOW_RESEARCH_ITEMS}.`, { minimum: 1, maximum: MAX_SHOW_RESEARCH_ITEMS }),
      max_characters: int(`Optional serialized result budget; hard-capped at ${MAX_SHOW_RESEARCH_CHARACTERS}.`, { minimum: 1, maximum: MAX_SHOW_RESEARCH_CHARACTERS }),
    }, ['query']),
    run: async args => {
      const identity = currentIdentity()
      const request = makeResearchSearchRequest(args, identity.projectPath, identity.projectId, identity.showQuery)
      const app = await barrier()
      ensureSameProject(identity)
      return app.contextBank.searchResearch(request)
    },
  },
  {
    name: 'record_research_prior',
    description: 'Persist one bounded web-research prior supported by an exact cached research source/chunk excerpt. Use only for probable episode/position guidance; never present it as verified footage or attach exact source-media timestamps.',
    inputSchema: obj({
      query: str('Focused concept or scene query this prior answers.', { maxLength: CONTEXT_BANK_RESEARCH_QUERY_MAX }),
      text: str('Compact research-only conclusion. Do not claim that imported footage has been verified.', { maxLength: CONTEXT_BANK_RESEARCH_PRIOR_TEXT_MAX }),
      episode_number: int('Optional probable episode number supported by the cited research excerpt.', { minimum: 1, maximum: CONTEXT_BANK_RESEARCH_EPISODE_MAX }),
      position_hint: oneOf('Optional rough within-episode position only; never an exact timestamp.', POSITION_HINTS),
      confidence: num('Confidence in this research prior from 0 to 1.', { minimum: 0, maximum: 1 }),
      source_id: str('Exact cached research source ID that supports this prior.', { maxLength: CONTEXT_BANK_RESEARCH_ID_MAX }),
      chunk_id: str('Exact cached research chunk ID that supports this prior.', { maxLength: CONTEXT_BANK_RESEARCH_ID_MAX }),
      evidence_excerpt: str('Exact excerpt from that cached chunk. The Context Bank validates that the chunk/source/excerpt match.', { maxLength: CONTEXT_BANK_RESEARCH_EVIDENCE_EXCERPT_MAX }),
    }, ['query', 'text', 'confidence', 'source_id', 'chunk_id', 'evidence_excerpt']),
    run: async args => {
      const identity = currentIdentity()
      const request = makeResearchPriorWrite(args, identity.projectPath, identity.projectId, identity.showQuery)
      const app = await barrier()
      ensureSameProject(identity)
      return app.contextBank.putResearchPrior(request)
    },
  },
]

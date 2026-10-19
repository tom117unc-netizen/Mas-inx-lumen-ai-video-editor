import type { ContextBankObservationInput } from '@shared/context-bank-analysis'
import { CONTEXT_BANK_RESEARCH_QUERY_MAX } from '@shared/context-bank-research'
import { planAnimeSceneSearch, type SceneSearchObservation } from '@/editor/anime-scene-search'
import { getProject } from '@/editor/store'
import { desktop } from '@/lib/platform'
import { flushContextBankWrites } from '@/project/context-bank-runtime'
import { useSession } from '@/project/session'
import { int, obj, str, type AgentTool, type ToolArgs } from './kit'

export const MAX_SCENE_SEARCH_CANDIDATES = 12
export const MAX_SCENE_SEARCH_OBSERVATION_ASSETS = 24
const MAX_SCENE_SEARCH_OBSERVATIONS_PER_ASSET = 12
const MAX_SCENE_SEARCH_OBSERVATION_CHARACTERS = 4_000
const MAX_SCENE_SEARCH_RESEARCH_ITEMS = 12
const MAX_SCENE_SEARCH_RESEARCH_CHARACTERS = 12_000
const DEFAULT_SCENE_SEARCH_CANDIDATES = 8

export interface SourceSceneSearchRequest {
  projectPath: string
  projectId: string
  showQuery: string
  query: string
  maxCandidates: number
}

function requiredQuery(args: ToolArgs) {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  if (!query) throw new Error('Scene-search query is required')
  if (query.length > CONTEXT_BANK_RESEARCH_QUERY_MAX) throw new Error('Scene-search query is too long')
  return query
}

function candidateBudget(args: ToolArgs) {
  const value = args.max_candidates
  if (value === undefined || value === null) return DEFAULT_SCENE_SEARCH_CANDIDATES
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('max_candidates must be a number')
  return Math.max(1, Math.min(MAX_SCENE_SEARCH_CANDIDATES, Math.floor(value)))
}

export function makeSourceSceneSearchRequest(
  args: ToolArgs,
  projectPath: string | null,
  projectId: string,
  showQuery: string | undefined,
): SourceSceneSearchRequest {
  if (!projectPath) throw new Error('Save the project before planning a source scene search.')
  if (!projectId.trim()) throw new Error('Project id is required')
  if (!showQuery?.trim()) throw new Error('An anime-review project with a show query is required for source scene search.')
  return {
    projectPath,
    projectId,
    showQuery: showQuery.trim(),
    query: requiredQuery(args),
    maxCandidates: candidateBudget(args),
  }
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
    throw new Error('The project changed while Context Bank synchronization was finishing; retry the source scene-search request.')
  }
}

function boundedVideoAssetIds() {
  return Object.values(getProject().assets)
    .filter(asset => asset.kind === 'video' && !asset.source.missing)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_SCENE_SEARCH_OBSERVATION_ASSETS)
    .map(asset => asset.id)
}

async function cachedObservations(
  app: NonNullable<typeof desktop>,
  request: SourceSceneSearchRequest,
): Promise<{ observations: SceneSearchObservation[]; warnings: string[] }> {
  const observations: SceneSearchObservation[] = []
  const warnings: string[] = []

  for (const assetId of boundedVideoAssetIds()) {
    const result = await app.contextBank.getObservations({
      projectPath: request.projectPath,
      projectId: request.projectId,
      assetId,
      maxItems: MAX_SCENE_SEARCH_OBSERVATIONS_PER_ASSET,
      maxCharacters: MAX_SCENE_SEARCH_OBSERVATION_CHARACTERS,
    })
    for (const observation of result.observations as ContextBankObservationInput[]) {
      observations.push({ assetId, observation })
    }
    warnings.push(...result.warnings)
  }

  return { observations, warnings }
}

export const SOURCE_SCENE_SEARCH_TOOL: AgentTool = {
  name: 'plan_source_scene_search',
  description: 'Plan a bounded search for a scene in imported anime episodes using only cached show-research priors, cached verified source-time observations, and existing project indexes. Research tells Lumen where to look; actual footage must still confirm unverified candidates. This tool never fetches the web, transcribes media, runs vision, or scans whole episodes.',
  inputSchema: obj({
    query: str('Specific character moment, event, object, joke, or scene to locate.', { maxLength: CONTEXT_BANK_RESEARCH_QUERY_MAX }),
    max_candidates: int(`Optional result budget; hard-capped at ${MAX_SCENE_SEARCH_CANDIDATES}.`, { minimum: 1, maximum: MAX_SCENE_SEARCH_CANDIDATES }),
  }, ['query']),
  run: async args => {
    if (!desktop) throw new Error('Source scene search needs the Lumen desktop app.')

    const identity = currentIdentity()
    const request = makeSourceSceneSearchRequest(args, identity.projectPath, identity.projectId, identity.showQuery)

    // Edits/imports can have just changed the asset mirror. Never plan against a
    // Context Bank revision from before the current canonical project state.
    await flushContextBankWrites()
    ensureSameProject(identity)

    const research = await desktop.contextBank.searchResearch({
      projectPath: request.projectPath,
      projectId: request.projectId,
      query: request.query,
      maxItems: MAX_SCENE_SEARCH_RESEARCH_ITEMS,
      maxCharacters: MAX_SCENE_SEARCH_RESEARCH_CHARACTERS,
    })
    const verified = await cachedObservations(desktop, request)
    const candidates = planAnimeSceneSearch({
      query: request.query,
      project: getProject(),
      verifiedObservations: verified.observations,
      research,
      maxCandidates: request.maxCandidates,
    })

    return {
      projectId: request.projectId,
      showQuery: request.showQuery,
      query: request.query,
      candidates,
      researchTruncated: research.truncated,
      warnings: [...research.warnings, ...verified.warnings],
    }
  },
}

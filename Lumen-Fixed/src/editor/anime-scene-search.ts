import type { ContextBankObservationInput } from '@shared/context-bank-analysis'
import type { ContextBankResearchPositionHint, ContextBankResearchSearchResult } from '@shared/context-bank-research'
import { rankAnimeFootage } from './anime-footage-matcher'
import type { ReviewPlan } from './anime-review'
import { mapAnimeEpisodeAssets } from './anime-source-map'
import type { Project } from './types'

export type SceneSearchAuthority = 'verified-source' | 'research-prior' | 'indexed-source' | 'metadata'
export type SceneSearchStrategy = 'use-verified-range' | 'inspect-derived-window' | 'sample-episode-first' | 'inspect-indexed-window' | 'inspect-episode-metadata'

export interface SceneSearchObservation {
  assetId: string
  observation: ContextBankObservationInput
}

export interface SceneSearchCandidate {
  assetId: string
  episodeNumber?: number
  sourceStartSeconds?: number
  sourceEndSeconds?: number
  authority: SceneSearchAuthority
  score: number
  confidence: number
  evidenceIds: string[]
  reasons: string[]
  requiresVerification: boolean
  rangeDerived: boolean
  strategy: SceneSearchStrategy
}

export interface AnimeSceneSearchInput {
  query: string
  project: Project
  verifiedObservations: readonly SceneSearchObservation[]
  research: Pick<ContextBankResearchSearchResult, 'priors' | 'chunks'>
  maxCandidates?: number
}

const STOP = new Set('a an the and or of to in on at by for from with is are was were be been this that it its as but so i you we they he she his her their about what when where how why not just very really more than then can could would should do does did'.split(' '))
const AUTHORITY_ORDER: Record<SceneSearchAuthority, number> = {
  'verified-source': 4,
  'research-prior': 3,
  'indexed-source': 2,
  metadata: 1,
}

function tokens(value: string) {
  return [...new Set((value.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(word => !STOP.has(word)))]
}

function overlapCount(a: readonly string[], b: readonly string[]) {
  const other = new Set(b)
  return a.reduce((count, value) => count + (other.has(value) ? 1 : 0), 0)
}

function relevant(queryTokens: readonly string[], text: string) {
  if (!queryTokens.length) return false
  return overlapCount(queryTokens, tokens(text)) > 0
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function episodeByAsset(project: Project) {
  return new Map(mapAnimeEpisodeAssets(project).map(match => [match.assetId, match]))
}

function derivedPositionWindow(duration: number | undefined, hint: ContextBankResearchPositionHint | undefined) {
  if (!duration || !Number.isFinite(duration) || duration <= 0 || !hint || hint === 'unknown') return undefined
  // Keep research guidance broad enough to tolerate rough web summaries but
  // bounded enough that later media inspection does not scan an entire episode.
  const width = Math.min(duration * 0.28, 360)
  if (hint === 'early') return { start: 0, end: width }
  if (hint === 'late') return { start: Math.max(0, duration - width), end: duration }
  const middle = duration / 2
  return { start: Math.max(0, middle - width / 2), end: Math.min(duration, middle + width / 2) }
}

function rangeOverlapRatio(start: number, end: number, otherStart: number, otherEnd: number) {
  const intersection = Math.max(0, Math.min(end, otherEnd) - Math.max(start, otherStart))
  return intersection / Math.max(0.001, end - start)
}

function isSuppressedByMiss(
  assetId: string,
  start: number | undefined,
  end: number | undefined,
  queryTokens: readonly string[],
  observations: readonly SceneSearchObservation[],
) {
  if (start === undefined || end === undefined) return false
  return observations.some(item =>
    item.assetId === assetId
    && item.observation.kind === 'search-miss'
    && relevant(queryTokens, item.observation.text)
    && rangeOverlapRatio(start, end, item.observation.start, item.observation.end) >= 0.5)
}

function indexedMatches(project: Project, query: string) {
  const plan: ReviewPlan = {
    format: 'lumen-anime-review-plan',
    version: 1,
    projectId: project.id,
    thesis: '',
    intendedTone: '',
    beats: [{
      id: '__scene_search__',
      sequenceId: project.sequence?.id ?? 'main',
      startFrame: 0,
      endFrame: 1,
      purpose: 'context',
      commentary: query,
      evidenceStatus: 'unverified',
      visualRole: 'source-footage',
      assetIds: [],
    }],
  }
  return rankAnimeFootage(project, plan, { maxPerBeat: 30, minimumScore: 0.01, paddingSeconds: 1 }).__scene_search__ ?? []
}

/**
 * Pure, bounded scene-search planner. It ranks what Lumen already knows and
 * proposes where to inspect next; it never opens media, runs vision, fetches the
 * web, writes observations, or mutates the timeline/project.
 */
export function planAnimeSceneSearch(input: AnimeSceneSearchInput): SceneSearchCandidate[] {
  const query = input.query.trim()
  if (!query) throw new Error('Scene-search query is required')
  if (query.length > 1_000) throw new Error('Scene-search query is too long')
  const maxCandidates = clamp(Math.floor(input.maxCandidates ?? 12), 1, 50)
  const queryTokens = tokens(query)
  const episodes = episodeByAsset(input.project)
  const candidates: SceneSearchCandidate[] = []

  // 1) Verified source-time facts are the highest authority. Search misses are
  // negative evidence and therefore never become positive scene candidates.
  for (const item of input.verifiedObservations) {
    const observation = item.observation
    if (observation.kind === 'search-miss' || !relevant(queryTokens, observation.text)) continue
    const asset = input.project.assets[item.assetId]
    if (!asset || asset.kind !== 'video' || asset.source.missing) continue
    candidates.push({
      assetId: item.assetId,
      episodeNumber: episodes.get(item.assetId)?.episodeNumber,
      sourceStartSeconds: observation.start,
      sourceEndSeconds: observation.end,
      authority: 'verified-source',
      score: clamp(observation.confidence ?? 0.9, 0, 1),
      confidence: clamp(observation.confidence ?? 0.9, 0, 1),
      evidenceIds: [observation.id],
      reasons: ['Verified source-time observation matched the scene query.'],
      requiresVerification: false,
      rangeDerived: false,
      strategy: 'use-verified-range',
    })
  }

  // 2) Persisted research priors can choose likely imported episodes. They may
  // derive a rough region from early/middle/late, but that range stays explicitly
  // unverified until actual source inspection records an observation.
  for (const prior of input.research.priors) {
    if (!prior.episodeNumber) continue
    for (const match of episodes.values()) {
      if (match.episodeNumber !== prior.episodeNumber) continue
      const asset = input.project.assets[match.assetId]
      if (!asset) continue
      const range = derivedPositionWindow(asset.duration, prior.positionHint)
      if (isSuppressedByMiss(match.assetId, range?.start, range?.end, queryTokens, input.verifiedObservations)) continue
      candidates.push({
        assetId: match.assetId,
        episodeNumber: match.episodeNumber,
        ...(range ? { sourceStartSeconds: range.start, sourceEndSeconds: range.end } : {}),
        authority: 'research-prior',
        score: clamp(prior.confidence, 0, 1),
        confidence: clamp(prior.confidence, 0, 1),
        evidenceIds: [prior.id, prior.evidence.sourceId, prior.evidence.chunkId],
        reasons: [range
          ? `Web research prior suggests episode ${match.episodeNumber} and a rough ${prior.positionHint} region; this derived range is unverified.`
          : `Web research prior suggests episode ${match.episodeNumber}; research is unverified and supplies no source timestamp.`],
        requiresVerification: true,
        rangeDerived: Boolean(range),
        strategy: range ? 'inspect-derived-window' : 'sample-episode-first',
      })
    }
  }

  // Search-result chunks that explicitly label an episode are weaker research
  // guidance than a persisted prior, but can still narrow the candidate episode.
  for (const chunk of input.research.chunks) {
    if (!chunk.episodeNumber) continue
    for (const match of episodes.values()) {
      if (match.episodeNumber !== chunk.episodeNumber) continue
      candidates.push({
        assetId: match.assetId,
        episodeNumber: match.episodeNumber,
        authority: 'research-prior',
        score: clamp(0.45 + Math.min(0.45, chunk.score * 0.1), 0, 0.9),
        confidence: 0.55,
        evidenceIds: [chunk.sourceId, chunk.id],
        reasons: [`Cached web-research chunk explicitly labels episode ${match.episodeNumber}; no source timestamp has been verified.`],
        requiresVerification: true,
        rangeDerived: false,
        strategy: 'sample-episode-first',
      })
    }
  }

  // 3) Existing project transcript/cue/tag indexes give source-time windows, but
  // they remain candidates rather than verified evidence.
  for (const match of indexedMatches(input.project, query)) {
    if (isSuppressedByMiss(match.assetId, match.sourceStartSeconds, match.sourceEndSeconds, queryTokens, input.verifiedObservations)) continue
    const isMetadata = match.reasons.some(reason => reason === 'Source: metadata')
    candidates.push({
      assetId: match.assetId,
      episodeNumber: episodes.get(match.assetId)?.episodeNumber,
      sourceStartSeconds: match.sourceStartSeconds,
      sourceEndSeconds: match.sourceEndSeconds,
      authority: isMetadata ? 'metadata' : 'indexed-source',
      score: clamp(match.score, 0, 1),
      confidence: isMetadata ? 0.25 : clamp(match.score, 0.1, 0.85),
      evidenceIds: [],
      reasons: [...match.reasons, isMetadata ? 'Metadata is only a last-resort candidate.' : 'Indexed source text is not yet verified scene evidence.'],
      requiresVerification: true,
      rangeDerived: false,
      strategy: isMetadata ? 'inspect-episode-metadata' : 'inspect-indexed-window',
    })
  }

  // 4) Explicit episode filenames provide a deterministic final fallback only.
  for (const match of episodes.values()) {
    candidates.push({
      assetId: match.assetId,
      episodeNumber: match.episodeNumber,
      authority: 'metadata',
      score: clamp(match.confidence * 0.2, 0, 0.25),
      confidence: clamp(match.confidence * 0.35, 0, 0.4),
      evidenceIds: [],
      reasons: [`Filename explicitly maps this asset to episode ${match.episodeNumber}; no scene evidence is known.`],
      requiresVerification: true,
      rangeDerived: false,
      strategy: 'inspect-episode-metadata',
    })
  }

  // Remove exact duplicate candidates produced by overlapping metadata paths,
  // retaining the first (and therefore strongest) representation.
  const seen = new Set<string>()
  const unique = candidates.filter(candidate => {
    const key = [candidate.authority, candidate.assetId, candidate.sourceStartSeconds ?? '', candidate.sourceEndSeconds ?? ''].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  unique.sort((a, b) =>
    AUTHORITY_ORDER[b.authority] - AUTHORITY_ORDER[a.authority]
    || b.score - a.score
    || (a.episodeNumber ?? Number.MAX_SAFE_INTEGER) - (b.episodeNumber ?? Number.MAX_SAFE_INTEGER)
    || a.assetId.localeCompare(b.assetId)
    || (a.sourceStartSeconds ?? 0) - (b.sourceStartSeconds ?? 0))

  return unique.slice(0, maxCandidates)
}

import { planAnimeRoughCut } from '@/editor/anime-rough-cut'
import type { ReviewPlan, ReviewBeat } from '@/editor/anime-review'
import type { SceneSearchCandidate } from '@/editor/anime-scene-search'
import { getProject } from '@/editor/store'
import { list, obj, str, num, type AgentTool } from './kit'

const MAX_ROUGH_CUT_BEATS = 80
const MAX_CANDIDATES_PER_BEAT = 12

function readBeat(raw: unknown): ReviewBeat {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid rough-cut beat.')
  const value = raw as Record<string, unknown>
  const purpose = value.purpose
  if (!['evidence', 'context', 'reaction', 'transition', 'breathing-room'].includes(String(purpose))) throw new Error('Invalid rough-cut beat purpose.')
  return {
    id: String(value.id ?? ''),
    sequenceId: String(value.sequence_id ?? ''),
    startFrame: Number(value.start_frame ?? 0),
    endFrame: Number(value.end_frame ?? 0),
    purpose: purpose as ReviewBeat['purpose'],
    commentary: String(value.commentary ?? ''),
    claim: typeof value.claim === 'string' ? value.claim : undefined,
    evidenceStatus: 'unverified',
    visualRole: 'source-footage',
    assetIds: [],
    locked: value.locked === true,
  }
}

function readCandidate(raw: unknown): SceneSearchCandidate {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid rough-cut candidate.')
  const value = raw as Record<string, unknown>
  const authority = String(value.authority ?? '') as SceneSearchCandidate['authority']
  if (!['verified-source', 'indexed-source', 'research-prior', 'metadata'].includes(authority)) throw new Error('Invalid scene-search authority.')
  return {
    assetId: String(value.asset_id ?? ''), authority,
    score: Number(value.score ?? 0), confidence: Number(value.confidence ?? 0),
    evidenceIds: Array.isArray(value.evidence_ids) ? value.evidence_ids.filter((id): id is string => typeof id === 'string') : [],
    reasons: Array.isArray(value.reasons) ? value.reasons.filter((reason): reason is string => typeof reason === 'string') : [],
    requiresVerification: value.requires_verification !== false,
    rangeDerived: value.range_derived === true,
    strategy: String(value.strategy ?? 'inspect-indexed-window') as SceneSearchCandidate['strategy'],
    ...(typeof value.source_start_seconds === 'number' ? { sourceStartSeconds: value.source_start_seconds } : {}),
    ...(typeof value.source_end_seconds === 'number' ? { sourceEndSeconds: value.source_end_seconds } : {}),
  }
}

export const ANIME_ROUGH_CUT_TOOL: AgentTool = {
  name: 'plan_anime_review_rough_cut',
  description: 'Plan a non-mutating anime-review rough cut from explicit review beats and scene-search candidates. Verified source observations outrank research and are required before footage can be presented as factual evidence; unverified candidates are returned only for inspection or non-evidence illustration.',
  inputSchema: obj({
    beats: list('Review beats to plan.', obj({
      id: str('Stable beat ID.'), sequence_id: str('Exact timeline ID.'), start_frame: num('Beat start frame.'), end_frame: num('Beat end frame.'),
      purpose: str('One of evidence, context, reaction, transition, breathing-room.'), commentary: str('Narration/commentary for this beat.'), claim: str('Optional factual claim.'), locked: num('Use 1 to preserve the beat unchanged; omit for unlocked.'),
      candidates: list('Bounded candidates from plan_source_scene_search.', obj({
        asset_id: str('Exact source asset ID.'), authority: str('verified-source, indexed-source, research-prior, or metadata.'), score: num('Candidate score.'), confidence: num('Confidence 0–1.'),
        evidence_ids: list('Verified observation IDs when applicable.', str('Observation ID.')), reasons: list('Selection reasons.', str('Reason.')), requires_verification: num('Use 1 when source verification is still required.'), range_derived: num('Use 1 when range derives from a prior.'), strategy: str('Scene-search strategy.'), source_start_seconds: num('Optional source start seconds.'), source_end_seconds: num('Optional source end seconds.'),
      }, ['asset_id', 'authority', 'score', 'confidence'])),
    }, ['id', 'sequence_id', 'start_frame', 'end_frame', 'purpose', 'commentary', 'candidates'])),
  }, ['beats']),
  run: async args => {
    if (!Array.isArray(args.beats) || args.beats.length > MAX_ROUGH_CUT_BEATS) throw new Error(`Rough-cut planning is capped at ${MAX_ROUGH_CUT_BEATS} beats.`)
    const project = getProject()
    const candidatesByBeat: Record<string, SceneSearchCandidate[]> = {}
    const beats = args.beats.map(raw => {
      const beat = readBeat(raw)
      if (!beat.id || !beat.sequenceId || !Number.isSafeInteger(beat.startFrame) || !Number.isSafeInteger(beat.endFrame) || beat.endFrame <= beat.startFrame) throw new Error(`Invalid rough-cut beat ${beat.id || '(missing id)'}.`)
      const rawCandidates = (raw as Record<string, unknown>).candidates
      if (!Array.isArray(rawCandidates) || rawCandidates.length > MAX_CANDIDATES_PER_BEAT) throw new Error(`Beat ${beat.id} exceeds the ${MAX_CANDIDATES_PER_BEAT} candidate cap.`)
      candidatesByBeat[beat.id] = rawCandidates.map(readCandidate)
      return beat
    })
    const review: ReviewPlan = { format: 'lumen-anime-review-plan', version: 1, projectId: project.id, thesis: '', intendedTone: '', beats }
    return { project_id: project.id, decisions: planAnimeRoughCut(review, candidatesByBeat), mutation_applied: false }
  },
}

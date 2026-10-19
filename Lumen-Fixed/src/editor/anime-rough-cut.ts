import type { ReviewPlan, ReviewBeat } from './anime-review'
import type { SceneSearchAuthority, SceneSearchCandidate } from './anime-scene-search'

export type RoughCutDecisionStatus = 'selected' | 'needs-verification' | 'unresolved' | 'locked'

export interface RoughCutDecision {
  beatId: string
  status: RoughCutDecisionStatus
  assetId?: string
  authority?: SceneSearchAuthority
  sourceStartSeconds?: number
  sourceEndSeconds?: number
  canPresentAsEvidence: boolean
  reason: string
  inspectionCandidates?: SceneSearchCandidate[]
}

const authorityRank: Record<SceneSearchAuthority, number> = {
  'verified-source': 4,
  'indexed-source': 3,
  'research-prior': 2,
  metadata: 1,
}

function sortCandidates(candidates: SceneSearchCandidate[]): SceneSearchCandidate[] {
  return [...candidates].sort((a, b) =>
    authorityRank[b.authority] - authorityRank[a.authority]
    || b.score - a.score
    || b.confidence - a.confidence
    || a.assetId.localeCompare(b.assetId)
    || (a.sourceStartSeconds ?? 0) - (b.sourceStartSeconds ?? 0),
  )
}

function selected(beat: ReviewBeat, candidate: SceneSearchCandidate, canPresentAsEvidence: boolean): RoughCutDecision {
  return {
    beatId: beat.id,
    status: 'selected',
    assetId: candidate.assetId,
    authority: candidate.authority,
    sourceStartSeconds: candidate.sourceStartSeconds,
    sourceEndSeconds: candidate.sourceEndSeconds,
    canPresentAsEvidence,
    reason: canPresentAsEvidence
      ? 'Verified source observation supports this evidence beat.'
      : `Selected ${candidate.authority} footage for non-evidence illustration.`,
  }
}

export function planAnimeRoughCut(review: ReviewPlan, candidatesByBeat: Record<string, SceneSearchCandidate[]>): RoughCutDecision[] {
  return review.beats.map(beat => {
    if (beat.locked) {
      return { beatId: beat.id, status: 'locked', canPresentAsEvidence: false, reason: 'Beat is locked; existing edit must be preserved.' }
    }

    const candidates = sortCandidates(candidatesByBeat[beat.id] ?? [])
    if (beat.purpose === 'evidence') {
      const verified = candidates.find(candidate => candidate.authority === 'verified-source' && !candidate.requiresVerification)
      if (verified) return selected(beat, verified, true)
      if (candidates.length) {
        return {
          beatId: beat.id,
          status: 'needs-verification',
          canPresentAsEvidence: false,
          reason: 'Evidence beat has candidate footage but no verified source observation yet.',
          inspectionCandidates: candidates,
        }
      }
      return { beatId: beat.id, status: 'unresolved', canPresentAsEvidence: false, reason: 'No source candidate was found for this evidence beat.' }
    }

    const best = candidates[0]
    if (best) return selected(beat, best, false)
    return { beatId: beat.id, status: 'unresolved', canPresentAsEvidence: false, reason: 'No suitable visual candidate was found for this beat.' }
  })
}

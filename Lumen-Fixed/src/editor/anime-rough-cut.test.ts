import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './new-project'
import type { ReviewPlan } from './anime-review'
import type { SceneSearchCandidate } from './anime-scene-search'
import { planAnimeRoughCut } from './anime-rough-cut'

function candidate(authority: SceneSearchCandidate['authority'], assetId: string, patch: Partial<SceneSearchCandidate> = {}): SceneSearchCandidate {
  return {
    assetId,
    authority,
    score: authority === 'verified-source' ? 0.9 : 0.8,
    confidence: authority === 'verified-source' ? 0.95 : 0.7,
    evidenceIds: authority === 'verified-source' ? ['obs-1'] : [],
    reasons: [authority],
    requiresVerification: authority !== 'verified-source',
    rangeDerived: false,
    strategy: authority === 'verified-source' ? 'use-verified-range' : 'inspect-indexed-window',
    sourceStartSeconds: 10,
    sourceEndSeconds: 20,
    ...patch,
  }
}

function plan(purpose: 'evidence' | 'context' = 'evidence', locked = false): ReviewPlan {
  const project = createEmptyProject('rough-cut')
  return {
    format: 'lumen-anime-review-plan', version: 1, projectId: project.id, thesis: 'test', intendedTone: 'test',
    beats: [{ id: 'beat-1', sequenceId: project.sequence?.id ?? 'main', startFrame: 0, endFrame: 100, purpose, commentary: 'pudding scene', claim: 'The scene happens here', evidenceStatus: 'unverified', visualRole: 'source-footage', assetIds: [], locked }],
  }
}

describe('planAnimeRoughCut', () => {
  it('uses verified source footage for an evidence beat even when research scores highly', () => {
    const review = plan()
    const result = planAnimeRoughCut(review, { 'beat-1': [candidate('research-prior', 'ep2', { score: 1 }), candidate('verified-source', 'ep5')] })
    expect(result[0]).toMatchObject({ beatId: 'beat-1', status: 'selected', assetId: 'ep5', authority: 'verified-source', canPresentAsEvidence: true })
  })

  it('does not present research or indexed candidates as proof when verified evidence is absent', () => {
    const review = plan()
    const result = planAnimeRoughCut(review, { 'beat-1': [candidate('indexed-source', 'ep5'), candidate('research-prior', 'ep2')] })
    expect(result[0]).toMatchObject({ beatId: 'beat-1', status: 'needs-verification', canPresentAsEvidence: false })
    expect(result[0].inspectionCandidates?.map(item => item.assetId)).toEqual(['ep5', 'ep2'])
  })

  it('selects the strongest available candidate for non-evidence illustration without upgrading it to evidence', () => {
    const review = plan('context')
    const result = planAnimeRoughCut(review, { 'beat-1': [candidate('metadata', 'ep1'), candidate('research-prior', 'ep2'), candidate('indexed-source', 'ep3')] })
    expect(result[0]).toMatchObject({ beatId: 'beat-1', status: 'selected', assetId: 'ep3', authority: 'indexed-source', canPresentAsEvidence: false })
  })

  it('preserves locked beats without selecting replacement footage', () => {
    const review = plan('context', true)
    const result = planAnimeRoughCut(review, { 'beat-1': [candidate('verified-source', 'ep5')] })
    expect(result[0]).toMatchObject({ beatId: 'beat-1', status: 'locked', canPresentAsEvidence: false })
    expect(result[0].assetId).toBeUndefined()
  })
})

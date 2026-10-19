import { describe, expect, it } from 'vitest'
import type { ContextBankResearchSearchResult } from '@shared/context-bank-research'
import { createClip, createTrack } from './defaults'
import { createEmptyProject } from './new-project'
import { planAnimeSceneSearch, type SceneSearchObservation } from './anime-scene-search'
import { planAnimeRoughCut } from './anime-rough-cut'
import type { ReviewPlan } from './anime-review'
import { materializeMouthSyncClips, planMouthSync } from './anime-pngtuber-sync'
import { previewAnimeAiPatch, verifyApprovedProposal } from './anime-review-approval'

function source(name: string, mime: string) {
  return { type: 'file' as const, url: `file:///${name}`, path: `C:\\media\\${name}`, mime, fileName: name, size: 1, mtime: 1 }
}

describe('anime review workflow regression', () => {
  it('keeps research subordinate to verified episode evidence and mouth edits approval-safe', () => {
    const project = createEmptyProject('workflow', { fps: 30 })
    project.animeReview = { showQuery: 'Recently, My Sister Is Unusual' }
    project.assets.ep2 = { id: 'ep2', name: 'Show S01E02.mp4', kind: 'video', source: source('Show S01E02.mp4', 'video/mp4'), addedAt: 1, duration: 1440 }
    project.assets.ep5 = { id: 'ep5', name: 'Show S01E05.mp4', kind: 'video', source: source('Show S01E05.mp4', 'video/mp4'), addedAt: 1, duration: 1440 }
    project.assets.closed = { id: 'closed', name: 'avatar_closed_B.png', kind: 'image', source: source('avatar_closed_B.png', 'image/png'), addedAt: 1 }
    project.assets.open = { id: 'open', name: 'avatar_open_B.png', kind: 'image', source: source('avatar_open_B.png', 'image/png'), addedAt: 1 }
    const video = createTrack('video', { id: 'mouth-track', name: 'PNGTuber' })
    project.tracks.push(video)
    const reference = createClip({ id: 'reference', kind: 'image', assetId: 'closed', trackId: video.id, start: 0, duration: 300, transform: { x: 100, y: 20, scale: 0.8, opacity: 1 } })
    project.clips.reference = reference

    const observations: SceneSearchObservation[] = [{ assetId: 'ep5', observation: { id: 'obs-pudding', kind: 'scene', start: 300, end: 315, text: 'Mitsuki pudding scene', confidence: 0.98, provenance: { producer: 'workflow-test', createdAt: 1 }, analysisVersion: 'test-v1' } }]
    const research: ContextBankResearchSearchResult = {
      projectId: project.id,
      priors: [{ id: 'prior-wrong', query: 'pudding', text: 'Pudding scene is episode 2', episodeNumber: 2, positionHint: 'middle', confidence: 1, evidence: { sourceId: 'web', chunkId: 'chunk', excerpt: 'Episode 2 pudding' }, provenance: { producer: 'workflow-test', analysisVersion: 'test-v1', createdAt: 1 } }],
      chunks: [], truncated: false, warnings: [],
    }
    const candidates = planAnimeSceneSearch({ query: 'Mitsuki pudding scene', project, verifiedObservations: observations, research, maxCandidates: 8 })
    expect(candidates[0]).toMatchObject({ assetId: 'ep5', authority: 'verified-source', requiresVerification: false })

    const review: ReviewPlan = { format: 'lumen-anime-review-plan', version: 1, projectId: project.id, thesis: 'test', intendedTone: 'test', beats: [{ id: 'pudding', sequenceId: project.sequence?.id ?? 'main', startFrame: 0, endFrame: 120, purpose: 'evidence', commentary: 'pudding', claim: 'pudding scene', evidenceStatus: 'unverified', visualRole: 'source-footage', assetIds: [] }] }
    const decision = planAnimeRoughCut(review, { pudding: candidates })[0]
    expect(decision).toMatchObject({ status: 'selected', assetId: 'ep5', authority: 'verified-source', canPresentAsEvidence: true })

    const intervals = planMouthSync({ peaks: [0, 0, 1, 1, 0, 0], peaksPerSecond: 2 }, { timelineStartFrame: 0, durationFrames: 90, sourceInSeconds: 0 }, { fps: 30, smoothingMs: 0, minimumHoldFrames: 1 })
    const generated = materializeMouthSyncClips(intervals, reference, { destinationTrackId: video.id, closedAssetId: 'closed', openAssetId: 'open', clipIds: intervals.map((_, i) => `mouth-${i}`) })
    const patch = { format: 'lumen-ai-patch' as const, version: 1 as const, projectId: project.id, edits: generated.map(clip => ({ op: 'addClip' as const, sequenceId: project.sequence?.id ?? 'main', clipId: clip.id, clip })) }
    const before = JSON.stringify(project)
    const proposal = previewAnimeAiPatch(project, patch)
    expect(JSON.stringify(project)).toBe(before)
    expect(proposal.changes.every(change => change.before === undefined)).toBe(true)
    const approved = verifyApprovedProposal(project, proposal)
    expect(generated.every(clip => approved.clips[clip.id]?.assetId === clip.assetId)).toBe(true)
    expect(generated.every(clip => project.clips[clip.id] === undefined)).toBe(true)

    const changed = structuredClone(project)
    changed.name = 'changed after proposal'
    expect(() => verifyApprovedProposal(changed, proposal)).toThrow(/changed after preview|review the proposal again/i)
    expect(generated.every(clip => changed.clips[clip.id] === undefined)).toBe(true)
  })

  it('never upgrades a research-only scene candidate into evidence', () => {
    const project = createEmptyProject('research-only')
    project.assets.ep2 = { id: 'ep2', name: 'Show S01E02.mp4', kind: 'video', source: source('Show S01E02.mp4', 'video/mp4'), addedAt: 1, duration: 1200 }
    const review: ReviewPlan = { format: 'lumen-anime-review-plan', version: 1, projectId: project.id, thesis: '', intendedTone: '', beats: [{ id: 'claim', sequenceId: project.sequence?.id ?? 'main', startFrame: 0, endFrame: 30, purpose: 'evidence', commentary: 'claim', evidenceStatus: 'unverified', visualRole: 'source-footage', assetIds: [] }] }
    const decision = planAnimeRoughCut(review, { claim: [{ assetId: 'ep2', authority: 'research-prior', score: 1, confidence: 1, evidenceIds: ['prior'], reasons: ['web'], requiresVerification: true, rangeDerived: true, strategy: 'inspect-derived-window', sourceStartSeconds: 100, sourceEndSeconds: 200 }] })[0]
    expect(decision).toMatchObject({ status: 'needs-verification', canPresentAsEvidence: false })
  })
})

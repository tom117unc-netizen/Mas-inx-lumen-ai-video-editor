import { describe, expect, it } from 'vitest'
import type { ContextBankObservationInput } from '@shared/context-bank-analysis'
import type { ContextBankResearchPrior, ContextBankResearchSearchResult } from '@shared/context-bank-research'
import { createEmptyProject } from './new-project'
import type { Asset, Project } from './types'
import { planAnimeSceneSearch, type SceneSearchObservation } from './anime-scene-search'

function episodeAsset(id: string, episode: number, patch: Partial<Asset> = {}): Asset {
  const fileName = `Frieren Episode ${String(episode).padStart(2, '0')}.mkv`
  return {
    id,
    name: fileName,
    kind: 'video',
    duration: 1_200,
    source: {
      type: 'file',
      url: `file:///${fileName}`,
      path: `D:\\Anime\\${fileName}`,
      mime: 'video/x-matroska',
      fileName,
      size: 100,
      mtime: 1,
    },
    addedAt: 1,
    ...patch,
  }
}

function projectWith(...assets: Asset[]): Project {
  const project = createEmptyProject('Frieren')
  project.assets = Object.fromEntries(assets.map(asset => [asset.id, asset]))
  return project
}

function prior(id: string, episodeNumber: number, patch: Partial<ContextBankResearchPrior> = {}): ContextBankResearchPrior {
  return {
    id,
    query: 'pudding scene',
    text: `Research suggests the pudding scene is in episode ${episodeNumber}.`,
    episodeNumber,
    confidence: 0.8,
    evidence: { sourceId: 'source-1', chunkId: `chunk-${episodeNumber}`, excerpt: `Episode ${episodeNumber} pudding scene.` },
    provenance: { producer: 'anime-review-ai', analysisVersion: 'ai-research-prior-v1', createdAt: 1 },
    ...patch,
  }
}

function research(priors: ContextBankResearchPrior[] = []): ContextBankResearchSearchResult {
  return { projectId: 'project-1', priors, chunks: [], truncated: false, warnings: [] }
}

function observation(assetId: string, input: Partial<ContextBankObservationInput> & Pick<ContextBankObservationInput, 'id' | 'kind' | 'start' | 'end' | 'text'>): SceneSearchObservation {
  return {
    assetId,
    observation: {
      confidence: 0.9,
      provenance: { producer: 'vision-test', createdAt: 1 },
      analysisVersion: 'scene-v1',
      ...input,
    },
  }
}

describe('planAnimeSceneSearch authority order', () => {
  it('ranks exact verified source evidence above a contradictory web-research prior', () => {
    const project = projectWith(episodeAsset('ep2', 2), episodeAsset('ep5', 5))
    const verified = observation('ep5', {
      id: 'obs-pudding',
      kind: 'scene-match',
      start: 611,
      end: 621,
      text: 'Mitsuki is eating pudding at the table.',
      confidence: 0.97,
    })

    const candidates = planAnimeSceneSearch({
      query: 'Mitsuki pudding scene',
      project,
      verifiedObservations: [verified],
      research: research([prior('wrong-web-prior', 2, { confidence: 0.95 })]),
    })

    expect(candidates[0]).toMatchObject({
      assetId: 'ep5',
      episodeNumber: 5,
      authority: 'verified-source',
      sourceStartSeconds: 611,
      sourceEndSeconds: 621,
      requiresVerification: false,
      rangeDerived: false,
      strategy: 'use-verified-range',
    })
    expect(candidates[0]?.evidenceIds).toContain('obs-pudding')
    expect(candidates.some(candidate => candidate.authority === 'research-prior' && candidate.assetId === 'ep2')).toBe(true)
  })

  it('turns an explicit research position hint into a clearly derived unverified window', () => {
    const project = projectWith(episodeAsset('ep5', 5))
    const candidates = planAnimeSceneSearch({
      query: 'pudding scene',
      project,
      verifiedObservations: [],
      research: research([prior('prior-5', 5, { positionHint: 'middle' })]),
    })

    expect(candidates[0]).toMatchObject({
      assetId: 'ep5',
      episodeNumber: 5,
      authority: 'research-prior',
      requiresVerification: true,
      rangeDerived: true,
      strategy: 'inspect-derived-window',
    })
    expect(candidates[0]?.sourceStartSeconds).toBeGreaterThan(0)
    expect(candidates[0]?.sourceEndSeconds).toBeLessThan(1_200)
    expect(candidates[0]?.reasons.join(' ')).toMatch(/research.*unverified|unverified.*research/i)
  })

  it('never invents source timestamps from an episode-only research prior', () => {
    const project = projectWith(episodeAsset('ep3', 3))
    const [candidate] = planAnimeSceneSearch({
      query: 'village arrival',
      project,
      verifiedObservations: [],
      research: research([prior('prior-3', 3, {
        query: 'village arrival',
        text: 'Research suggests episode 3 contains the village arrival.',
      })]),
    })

    expect(candidate).toMatchObject({
      assetId: 'ep3',
      episodeNumber: 3,
      authority: 'research-prior',
      requiresVerification: true,
      rangeDerived: false,
      strategy: 'sample-episode-first',
    })
    expect(candidate?.sourceStartSeconds).toBeUndefined()
    expect(candidate?.sourceEndSeconds).toBeUndefined()
  })

  it('ranks an indexed transcript/cue match above metadata-only episode candidates', () => {
    const indexed = episodeAsset('ep7', 7, {
      transcript: [{ start: 300, end: 309, text: 'The party finally reaches the northern village.' }],
    })
    const metadataOnly = episodeAsset('ep8', 8)
    const candidates = planAnimeSceneSearch({
      query: 'party reaches northern village',
      project: projectWith(indexed, metadataOnly),
      verifiedObservations: [],
      research: research(),
    })

    expect(candidates[0]).toMatchObject({ assetId: 'ep7', authority: 'indexed-source', requiresVerification: true })
    expect(candidates.some(candidate => candidate.assetId === 'ep8' && candidate.authority === 'metadata')).toBe(true)
  })

  it('suppresses a research-derived window already covered by a verified search miss', () => {
    const project = projectWith(episodeAsset('ep5', 5))
    const miss = observation('ep5', {
      id: 'miss-middle',
      kind: 'search-miss',
      start: 300,
      end: 900,
      text: 'Pudding scene was not found in this searched middle window.',
      confidence: 1,
    })
    const candidates = planAnimeSceneSearch({
      query: 'pudding scene',
      project,
      verifiedObservations: [miss],
      research: research([prior('prior-5', 5, { positionHint: 'middle' })]),
    })

    expect(candidates.some(candidate => candidate.assetId === 'ep5' && candidate.authority === 'research-prior')).toBe(false)
    expect(candidates.some(candidate => candidate.assetId === 'ep5' && candidate.authority === 'metadata')).toBe(true)
  })

  it('applies a deterministic hard candidate limit without mutating the project', () => {
    const project = projectWith(episodeAsset('ep1', 1), episodeAsset('ep2', 2), episodeAsset('ep3', 3))
    const before = JSON.stringify(project)
    const candidates = planAnimeSceneSearch({
      query: 'some scene',
      project,
      verifiedObservations: [],
      research: research(),
      maxCandidates: 2,
    })

    expect(candidates).toHaveLength(2)
    expect(candidates.map(candidate => candidate.assetId)).toEqual(['ep1', 'ep2'])
    expect(JSON.stringify(project)).toBe(before)
  })
})

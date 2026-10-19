import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Asset, Project } from '@/editor/types'
import type { ContextBankObservationInput, ContextBankObservationQuery } from '@shared/context-bank-analysis'
import type { ContextBankResearchSearchRequest } from '@shared/context-bank-research'
import { createEmptyProject } from '@/editor/new-project'

const mocks = vi.hoisted(() => ({
  path: 'D:\\Reviews\\Frieren.lumen' as string | null,
  project: null as unknown as Project,
  order: [] as string[],
  flush: vi.fn(async () => { mocks.order.push('flush') }),
  searchResearch: vi.fn(async (_request: ContextBankResearchSearchRequest) => {
    mocks.order.push('searchResearch')
    return {
      projectId: 'project-1',
      priors: [{
        id: 'prior-5',
        query: 'pudding scene',
        text: 'Research suggests episode 5.',
        episodeNumber: 5,
        positionHint: 'middle' as const,
        confidence: 0.8,
        evidence: { sourceId: 'source-1', chunkId: 'chunk-5', excerpt: 'Episode 5 pudding scene.' },
        provenance: { producer: 'anime-review-ai', analysisVersion: 'ai-research-prior-v1', createdAt: 1 },
      }],
      chunks: [],
      truncated: false,
      warnings: [],
    }
  }),
  getObservations: vi.fn(async (request: ContextBankObservationQuery) => {
    mocks.order.push(`getObservations:${request.assetId}`)
    const observations: ContextBankObservationInput[] = request.assetId === 'ep5' ? [{
      id: 'verified-pudding',
      kind: 'scene-match',
      start: 611,
      end: 621,
      text: 'Mitsuki pudding scene at the table.',
      confidence: 0.97,
      provenance: { producer: 'vision-test', createdAt: 1 },
      analysisVersion: 'scene-v1',
    }] : []
    return {
      projectId: 'project-1',
      assetId: request.assetId,
      fingerprint: `fingerprint-${request.assetId}`,
      observations,
      truncated: false,
      warnings: [],
    }
  }),
}))

vi.mock('@/editor/store', async importOriginal => {
  const actual = await importOriginal<typeof import('@/editor/store')>()
  return { ...actual, getProject: () => mocks.project }
})
vi.mock('@/project/session', () => ({ useSession: { getState: () => ({ path: mocks.path }) } }))
vi.mock('@/project/context-bank-runtime', () => ({ flushContextBankWrites: mocks.flush }))
vi.mock('@/lib/platform', () => ({
  desktop: { contextBank: { searchResearch: mocks.searchResearch, getObservations: mocks.getObservations } },
}))

import {
  MAX_SCENE_SEARCH_CANDIDATES,
  MAX_SCENE_SEARCH_OBSERVATION_ASSETS,
  SOURCE_SCENE_SEARCH_TOOL,
  makeSourceSceneSearchRequest,
} from './source-scene-search'

function episodeAsset(id: string, episode: number): Asset {
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
  }
}

function reviewProject(count = 2) {
  const project = createEmptyProject('Frieren', {}, { version: 1, showQuery: 'Frieren' })
  project.id = 'project-1'
  project.assets = {}
  const episodes = count === 2 ? [2, 5] : Array.from({ length: count }, (_, index) => index + 1)
  for (const episode of episodes) {
    const asset = episodeAsset(`ep${episode}`, episode)
    project.assets[asset.id] = asset
  }
  return project
}

describe('source scene-search planning tool', () => {
  beforeEach(() => {
    mocks.path = 'D:\\Reviews\\Frieren.lumen'
    mocks.project = reviewProject()
    mocks.order.length = 0
    mocks.flush.mockReset().mockImplementation(async () => { mocks.order.push('flush') })
    mocks.searchResearch.mockClear()
    mocks.getObservations.mockClear()
  })

  it('requires a saved anime-review project and hard-clamps the candidate budget', () => {
    expect(() => makeSourceSceneSearchRequest({ query: 'pudding scene' }, null, 'project-1', 'Frieren')).toThrow(/save/i)
    expect(() => makeSourceSceneSearchRequest({ query: 'pudding scene' }, mocks.path, 'project-1', undefined)).toThrow(/anime.review/i)
    expect(makeSourceSceneSearchRequest({ query: 'pudding scene', max_candidates: 9999 }, mocks.path, 'project-1', 'Frieren')).toEqual({
      projectPath: mocks.path,
      projectId: 'project-1',
      showQuery: 'Frieren',
      query: 'pudding scene',
      maxCandidates: MAX_SCENE_SEARCH_CANDIDATES,
    })
  })

  it('flushes first, reads only bounded cached evidence, and returns verified source evidence above research', async () => {
    const result = await SOURCE_SCENE_SEARCH_TOOL.run({ query: 'Mitsuki pudding scene', max_candidates: 4 }) as {
      candidates: Array<{ assetId: string; authority: string; sourceStartSeconds?: number }>
    }

    expect(mocks.order[0]).toBe('flush')
    expect(mocks.searchResearch).toHaveBeenCalledTimes(1)
    expect(mocks.getObservations.mock.calls.length).toBeLessThanOrEqual(MAX_SCENE_SEARCH_OBSERVATION_ASSETS)
    for (const [request] of mocks.getObservations.mock.calls) {
      expect(request.maxItems).toBeLessThanOrEqual(12)
      expect(request.maxCharacters).toBeLessThanOrEqual(4_000)
    }
    const researchRequest = mocks.searchResearch.mock.calls[0]![0]
    expect(researchRequest.maxItems).toBeLessThanOrEqual(12)
    expect(researchRequest.maxCharacters).toBeLessThanOrEqual(12_000)
    expect(result.candidates).toHaveLength(4)
    expect(result.candidates[0]).toMatchObject({ assetId: 'ep5', authority: 'verified-source', sourceStartSeconds: 611 })
    expect(result.candidates.some(candidate => candidate.authority === 'research-prior')).toBe(true)
  })

  it('never queries observations for more than the hard asset cap', async () => {
    mocks.project = reviewProject(MAX_SCENE_SEARCH_OBSERVATION_ASSETS + 8)

    await SOURCE_SCENE_SEARCH_TOOL.run({ query: 'some scene', max_candidates: 2 })

    expect(mocks.getObservations).toHaveBeenCalledTimes(MAX_SCENE_SEARCH_OBSERVATION_ASSETS)
  })

  it('refuses stale results when the active project changes during the sync barrier', async () => {
    mocks.flush.mockImplementationOnce(async () => {
      mocks.order.push('flush')
      mocks.project = reviewProject()
      mocks.project.id = 'project-2'
    })

    await expect(SOURCE_SCENE_SEARCH_TOOL.run({ query: 'pudding scene' })).rejects.toThrow(/project changed/i)
    expect(mocks.searchResearch).not.toHaveBeenCalled()
    expect(mocks.getObservations).not.toHaveBeenCalled()
  })
})

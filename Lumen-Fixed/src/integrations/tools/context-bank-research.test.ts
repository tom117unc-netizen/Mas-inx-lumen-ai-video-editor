import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  path: 'D:\\Reviews\\review.lumen' as string | null,
  projectId: 'project-1',
  showQuery: 'Frieren' as string | undefined,
  order: [] as string[],
  flush: vi.fn(async () => { mocks.order.push('flush') }),
  getResearchStatus: vi.fn(async () => {
    mocks.order.push('getResearchStatus')
    return { projectId: 'project-1', sourceCount: 2, chunkCount: 10, priorCount: 1, warnings: [] }
  }),
  searchResearch: vi.fn(async () => {
    mocks.order.push('searchResearch')
    return { projectId: 'project-1', priors: [], chunks: [], truncated: false, warnings: [] }
  }),
  putResearchPrior: vi.fn(async (request: unknown) => {
    mocks.order.push('putResearchPrior')
    return request
  }),
}))

vi.mock('@/editor/store', async importOriginal => {
  const actual = await importOriginal<typeof import('@/editor/store')>()
  return {
    ...actual,
    getProject: () => ({
      id: mocks.projectId,
      animeReview: mocks.showQuery ? { version: 1, showQuery: mocks.showQuery } : undefined,
    }),
  }
})
vi.mock('@/project/session', () => ({ useSession: { getState: () => ({ path: mocks.path }) } }))
vi.mock('@/project/context-bank-runtime', () => ({ flushContextBankWrites: mocks.flush }))
vi.mock('@/lib/platform', () => ({
  desktop: {
    contextBank: {
      getResearchStatus: mocks.getResearchStatus,
      searchResearch: mocks.searchResearch,
      putResearchPrior: mocks.putResearchPrior,
    },
  },
}))

import {
  CONTEXT_BANK_RESEARCH_TOOLS,
  MAX_SHOW_RESEARCH_CHARACTERS,
  MAX_SHOW_RESEARCH_ITEMS,
  makeResearchPriorWrite,
  makeResearchSearchRequest,
  makeResearchStatusRequest,
} from './context-bank-research'

describe('Context Bank show-research tool requests', () => {
  beforeEach(() => {
    mocks.path = 'D:\\Reviews\\review.lumen'
    mocks.projectId = 'project-1'
    mocks.showQuery = 'Frieren'
    mocks.order.length = 0
    mocks.flush.mockReset().mockImplementation(async () => { mocks.order.push('flush') })
    mocks.getResearchStatus.mockClear()
    mocks.searchResearch.mockClear()
    mocks.putResearchPrior.mockClear()
  })

  it('requires a saved anime-review project for every research request', () => {
    expect(() => makeResearchStatusRequest(null, 'project-1', 'Frieren')).toThrow(/save/i)
    expect(() => makeResearchStatusRequest('D:\\Reviews\\review.lumen', 'project-1', undefined)).toThrow(/anime.review/i)
    expect(() => makeResearchSearchRequest({ query: 'pudding scene' }, 'D:\\Reviews\\review.lumen', '', 'Frieren')).toThrow(/project id/i)
  })

  it('builds a focused cache-only search request and hard-clamps result budgets', () => {
    const request = makeResearchSearchRequest({
      query: 'Which episode contains the pudding scene?',
      max_items: 999_999,
      max_characters: 999_999,
    }, 'D:\\Reviews\\review.lumen', 'project-1', 'Frieren')

    expect(request).toEqual({
      projectPath: 'D:\\Reviews\\review.lumen',
      projectId: 'project-1',
      query: 'Which episode contains the pudding scene?',
      maxItems: MAX_SHOW_RESEARCH_ITEMS,
      maxCharacters: MAX_SHOW_RESEARCH_CHARACTERS,
    })
    expect(JSON.stringify(request)).not.toMatch(/url|fetch|web|sql|clear/i)
  })

  it('builds one deterministic research prior with exact chunk evidence and fixed non-media provenance', () => {
    const args = {
      query: 'pudding scene',
      text: 'Research suggests the pudding scene is in episode 5.',
      episode_number: 5,
      position_hint: 'middle',
      confidence: 0.72,
      source_id: 'web-source-1',
      chunk_id: 'chunk-5',
      evidence_excerpt: 'Ep. 5 contains the pudding scene.',
    }
    const one = makeResearchPriorWrite(args, 'D:\\Reviews\\review.lumen', 'project-1', 'Frieren', 1234)
    const two = makeResearchPriorWrite(args, 'D:\\Reviews\\review.lumen', 'project-1', 'Frieren', 1234)

    expect(one).toEqual(two)
    expect(one.prior).toMatchObject({
      query: 'pudding scene',
      text: 'Research suggests the pudding scene is in episode 5.',
      episodeNumber: 5,
      positionHint: 'middle',
      confidence: 0.72,
      evidence: {
        sourceId: 'web-source-1',
        chunkId: 'chunk-5',
        excerpt: 'Ep. 5 contains the pudding scene.',
      },
      provenance: {
        producer: 'anime-review-ai',
        analysisVersion: 'ai-research-prior-v1',
        createdAt: 1234,
      },
    })
    expect(one.prior.id).toMatch(/^research-prior-[a-f0-9]{16}$/)
    expect(JSON.stringify(one.prior.provenance)).not.toMatch(/verified-media/i)
  })

  it('rejects incomplete evidence and invalid prior confidence before IPC', () => {
    const base = {
      query: 'village arrival',
      text: 'Research suggests episode 2.',
      confidence: 0.7,
      source_id: 'source-1',
      chunk_id: 'chunk-2',
      evidence_excerpt: 'Episode 2: The party reaches the village.',
    }
    expect(() => makeResearchPriorWrite({ ...base, evidence_excerpt: '' }, 'D:\\Reviews\\review.lumen', 'project-1', 'Frieren', 1)).toThrow(/excerpt/i)
    expect(() => makeResearchPriorWrite({ ...base, confidence: 1.2 }, 'D:\\Reviews\\review.lumen', 'project-1', 'Frieren', 1)).toThrow(/confidence/i)
  })

  it('flushes before all research reads/writes and refuses a project switch during the barrier', async () => {
    const status = CONTEXT_BANK_RESEARCH_TOOLS.find(tool => tool.name === 'get_show_research_status')!
    await status.run({})
    expect(mocks.order).toEqual(['flush', 'getResearchStatus'])

    mocks.order.length = 0
    const search = CONTEXT_BANK_RESEARCH_TOOLS.find(tool => tool.name === 'search_show_research')!
    await search.run({ query: 'pudding scene' })
    expect(mocks.order).toEqual(['flush', 'searchResearch'])

    mocks.order.length = 0
    const record = CONTEXT_BANK_RESEARCH_TOOLS.find(tool => tool.name === 'record_research_prior')!
    await record.run({
      query: 'pudding scene',
      text: 'Research suggests episode 5.',
      confidence: 0.7,
      source_id: 'source-1',
      chunk_id: 'chunk-5',
      evidence_excerpt: 'Ep. 5 contains the pudding scene.',
    })
    expect(mocks.order).toEqual(['flush', 'putResearchPrior'])

    mocks.order.length = 0
    mocks.flush.mockImplementationOnce(async () => {
      mocks.order.push('flush')
      mocks.projectId = 'project-2'
    })
    await expect(search.run({ query: 'another scene' })).rejects.toThrow(/project changed/i)
    expect(mocks.searchResearch).toHaveBeenCalledTimes(1)
  })
})

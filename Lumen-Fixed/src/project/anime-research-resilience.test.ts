import { describe, expect, it, vi } from 'vitest'
import type { ContextBankAPI } from '@shared/context-bank'
import type { ContextBankResearchStatusResult } from '@shared/context-bank-research'
import type { IntegrationsAPI } from '@shared/integrations'
import { createEmptyProject } from '@/editor/new-project'
import { seedAnimeResearchForProject } from './anime-research'

const projectPath = 'D:\\Reviews\\show.lumen'

function project() {
  const value = createEmptyProject('Frieren', {}, { version: 1, showQuery: 'Frieren' })
  value.id = 'project-1'
  return value
}

function researchStatus(patch: Partial<ContextBankResearchStatusResult> = {}): ContextBankResearchStatusResult {
  return {
    projectId: 'project-1',
    sourceCount: 0,
    chunkCount: 0,
    priorCount: 0,
    warnings: [],
    ...patch,
  }
}

function bank() {
  return {
    getResearchStatus: vi.fn(async () => researchStatus()),
    setResearchState: vi.fn(async request => researchStatus({ state: request.state })),
    replaceResearchSeed: vi.fn(async request => researchStatus({
      state: request.state,
      sourceCount: request.sources.length,
      chunkCount: request.chunks.length,
    })),
  } as unknown as ContextBankAPI
}

const resolved = {
  status: 'resolved' as const,
  query: 'Frieren',
  selected: {
    source: 'anilist' as const,
    externalId: '154587',
    canonicalTitle: 'Frieren: Beyond Journey’s End',
    aliases: ['Sousou no Frieren'],
    score: 1,
    year: 2023,
    format: 'TV',
    episodes: 28,
  },
  candidates: [],
}

function page(url: string) {
  return {
    url,
    title: 'Episode guide',
    site: 'example.com',
    text: 'Episode 2\nThe party reaches the village.\n\nEpisode 5\nA useful scene occurs.',
    links: [],
    images: [],
  }
}

function api(
  search: IntegrationsAPI['web']['search'],
  read: IntegrationsAPI['web']['read'],
) {
  return {
    animeCatalog: { resolve: vi.fn(async () => resolved) },
    web: { search, read },
  } as unknown as IntegrationsAPI
}

describe('anime research resilience', () => {
  it('skips a persistently failing page and still becomes ready from another page without mixing snippet fallback into a successful full-page seed', async () => {
    const contextBank = bank()
    const search = vi.fn(async () => [
      { title: 'bad', url: 'https://bad.example/guide', snippet: 'bad snippet should remain fallback-only' },
      { title: 'good', url: 'https://good.example/guide', snippet: 'good snippet should not replace the page' },
    ])
    const read = vi.fn(async (url: string) => {
      if (url.includes('bad.example')) throw new Error('503 Service Temporarily Unavailable')
      return page(url)
    })

    const result = await seedAnimeResearchForProject(project(), projectPath, {
      bank: contextBank,
      integrations: api(search as IntegrationsAPI['web']['search'], read as IntegrationsAPI['web']['read']),
      now: () => 1,
    })

    expect(result).toMatchObject({ status: 'ready' })
    expect(read.mock.calls.filter(([url]) => String(url).includes('bad.example'))).toHaveLength(3)
    expect(read.mock.calls.filter(([url]) => String(url).includes('good.example'))).toHaveLength(1)
    expect(contextBank.replaceResearchSeed).toHaveBeenCalledTimes(1)
    const request = vi.mocked(contextBank.replaceResearchSeed).mock.calls[0]?.[0]
    expect(request?.sources).toHaveLength(1)
    expect(request?.sources[0]?.url).toBe('https://good.example/guide')
    expect(request?.sources[0]?.text).not.toContain('Search-result snippet only')
    expect(request?.sources[0]?.text).not.toContain('bad snippet should remain fallback-only')
  })

  it('retries one transient page failure and succeeds on the next attempt', async () => {
    const contextBank = bank()
    const search = vi.fn(async () => [
      { title: 'guide', url: 'https://example.com/guide', snippet: 'guide' },
    ])
    let attempts = 0
    const read = vi.fn(async (url: string) => {
      attempts += 1
      if (attempts === 1) throw new Error('503 Service Temporarily Unavailable')
      return page(url)
    })

    const result = await seedAnimeResearchForProject(project(), projectPath, {
      bank: contextBank,
      integrations: api(search as IntegrationsAPI['web']['search'], read as IntegrationsAPI['web']['read']),
      now: () => 2,
    })

    expect(result).toMatchObject({ status: 'ready' })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('continues when one search query fails and later queries return usable pages', async () => {
    const contextBank = bank()
    let searches = 0
    const search = vi.fn(async () => {
      searches += 1
      if (searches === 1) throw new Error('503 Service Temporarily Unavailable')
      return [{ title: 'guide', url: 'https://example.com/guide', snippet: 'guide' }]
    })
    const read = vi.fn(async (url: string) => page(url))

    const result = await seedAnimeResearchForProject(project(), projectPath, {
      bank: contextBank,
      integrations: api(search as IntegrationsAPI['web']['search'], read as IntegrationsAPI['web']['read']),
      now: () => 3,
    })

    expect(result).toMatchObject({ status: 'ready' })
    expect(search.mock.calls.length).toBeGreaterThan(1)
    expect(contextBank.replaceResearchSeed).toHaveBeenCalledTimes(1)
  })

  it('falls back to clearly labelled search-result snippets when every full-page read fails', async () => {
    const contextBank = bank()
    const search = vi.fn(async () => [
      {
        title: 'Episode guide result',
        url: 'https://bad.example/guide',
        snippet: 'Episode 2: Frieren reaches the village and learns an important clue.',
      },
    ])
    const read = vi.fn(async () => {
      throw new Error('503 Service Temporarily Unavailable')
    })

    const result = await seedAnimeResearchForProject(project(), projectPath, {
      bank: contextBank,
      integrations: api(search as IntegrationsAPI['web']['search'], read as IntegrationsAPI['web']['read']),
      now: () => 4,
    })

    expect(result).toMatchObject({ status: 'ready' })
    expect(read).toHaveBeenCalledTimes(3)
    expect(contextBank.replaceResearchSeed).toHaveBeenCalledTimes(1)
    const request = vi.mocked(contextBank.replaceResearchSeed).mock.calls[0]?.[0]
    expect(request?.sources).toHaveLength(1)
    expect(request?.chunks.length).toBeGreaterThan(0)
    expect(request?.sources[0]?.url).toBe('https://bad.example/guide')
    expect(request?.sources[0]?.text).toContain('Search-result snippet only')
    expect(request?.sources[0]?.text).toContain('lower-confidence locator evidence')
    expect(request?.sources[0]?.text).toContain('Episode 2: Frieren reaches the village')
  })

  it('stays retryable error when every candidate page fails and no useful snippet exists', async () => {
    const contextBank = bank()
    const search = vi.fn(async () => [
      { title: 'bad', url: 'https://bad.example/guide', snippet: '' },
    ])
    const read = vi.fn(async () => {
      throw new Error('503 Service Temporarily Unavailable')
    })

    const result = await seedAnimeResearchForProject(project(), projectPath, {
      bank: contextBank,
      integrations: api(search as IntegrationsAPI['web']['search'], read as IntegrationsAPI['web']['read']),
      now: () => 5,
    })

    expect(result).toMatchObject({ status: 'error', retryable: true })
    expect(read).toHaveBeenCalledTimes(3)
    expect(contextBank.replaceResearchSeed).not.toHaveBeenCalled()
    expect(contextBank.setResearchState).toHaveBeenLastCalledWith(expect.objectContaining({
      state: expect.objectContaining({ status: 'error' }),
    }))
  })

  it('keeps the existing source and chunk bounds while tolerating failures', async () => {
    const contextBank = bank()
    const search = vi.fn(async (query: string) => Array.from({ length: 8 }, (_, index) => ({
      title: `${query}-${index}`,
      url: `https://example.com/${encodeURIComponent(query)}/${index}`,
      snippet: 'guide',
    })))
    const read = vi.fn(async (url: string) => page(url))

    const result = await seedAnimeResearchForProject(project(), projectPath, {
      bank: contextBank,
      integrations: api(search as IntegrationsAPI['web']['search'], read as IntegrationsAPI['web']['read']),
      now: () => 6,
    })

    expect(result).toMatchObject({ status: 'ready' })
    const request = vi.mocked(contextBank.replaceResearchSeed).mock.calls[0]?.[0]
    expect(request?.sources.length).toBeLessThanOrEqual(8)
    expect(request?.chunks.length).toBeLessThanOrEqual(256)
  })
})

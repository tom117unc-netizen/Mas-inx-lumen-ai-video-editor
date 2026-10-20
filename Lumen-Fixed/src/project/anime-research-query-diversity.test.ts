import { describe, expect, it, vi } from 'vitest'
import type { ContextBankAPI } from '@shared/context-bank'
import {
  validateResearchSeedWriteRequest,
  type ContextBankResearchStatusResult,
} from '@shared/context-bank-research'
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

function api(search: IntegrationsAPI['web']['search'], read: IntegrationsAPI['web']['read']) {
  return {
    animeCatalog: { resolve: vi.fn(async () => resolved) },
    web: { search, read },
  } as unknown as IntegrationsAPI
}

describe('anime research query diversity', () => {
  it('reserves source capacity for later episode-focused queries instead of letting the first broad query consume every slot', async () => {
    const contextBank = bank()
    const search = vi.fn(async (query: string) => {
      if (query.includes('overview characters')) {
        return Array.from({ length: 8 }, (_, index) => ({
          title: `Generic character result ${index}`,
          url: `https://generic.example/${index}`,
          snippet: `Character overview ${index}`,
        }))
      }
      if (query.includes('episode guide')) {
        return [{
          title: 'Episode guide',
          url: 'https://episodes.example/guide',
          snippet: 'Episode 2: the party reaches the village.',
        }]
      }
      return []
    })
    const read = vi.fn(async (url: string) => ({
      url,
      title: url.includes('episodes.example') ? 'Episode guide' : 'Character overview',
      site: new URL(url).hostname,
      text: url.includes('episodes.example')
        ? 'Episode 2\nThe party reaches the village and learns an important clue.'
        : 'Character overview with no episode locator information.',
      links: [],
      images: [],
    }))

    const result = await seedAnimeResearchForProject(project(), projectPath, {
      bank: contextBank,
      integrations: api(search as IntegrationsAPI['web']['search'], read as IntegrationsAPI['web']['read']),
      now: () => 10,
    })

    expect(result).toMatchObject({ status: 'ready' })
    expect(search.mock.calls.some(([query]) => String(query).includes('episode guide'))).toBe(true)
    const request = vi.mocked(contextBank.replaceResearchSeed).mock.calls[0]?.[0]
    expect(request?.sources.some(source => source.url === 'https://episodes.example/guide')).toBe(true)
    expect(request?.chunks.some(chunk => chunk.episodeNumber === 2)).toBe(true)
    expect(request?.sources.length).toBeLessThanOrEqual(8)
  })

  it('reserves chunk capacity for episode locators when an earlier overview page can fill the entire chunk budget', async () => {
    const contextBank = bank()
    const search = vi.fn(async (query: string) => {
      if (query.includes('overview characters')) {
        return [{ title: 'Huge overview', url: 'https://generic.example/huge', snippet: 'Huge overview' }]
      }
      if (query.includes('episode guide')) {
        return [{ title: 'Episode guide', url: 'https://episodes.example/guide', snippet: 'Episode 2 clue' }]
      }
      return []
    })
    const hugeOverview = Array.from({ length: 256 }, (_, index) => `Character note ${index} with general background.`).join('\n\n')
    const read = vi.fn(async (url: string) => ({
      url,
      title: url.includes('episodes.example') ? 'Episode guide' : 'Huge overview',
      site: new URL(url).hostname,
      text: url.includes('episodes.example')
        ? 'Episode 2\nThe party reaches the village and learns an important clue.'
        : hugeOverview,
      links: [],
      images: [],
    }))

    const result = await seedAnimeResearchForProject(project(), projectPath, {
      bank: contextBank,
      integrations: api(search as IntegrationsAPI['web']['search'], read as IntegrationsAPI['web']['read']),
      now: () => 11,
    })

    expect(result).toMatchObject({ status: 'ready' })
    const request = vi.mocked(contextBank.replaceResearchSeed).mock.calls[0]?.[0]
    expect(request?.sources.some(source => source.url === 'https://episodes.example/guide')).toBe(true)
    expect(request?.chunks.some(chunk => chunk.episodeNumber === 2)).toBe(true)
    expect(request?.chunks.length).toBeLessThanOrEqual(256)
  })

  it('keeps a long episode-guide line as chunk text without exceeding the bounded heading limit', async () => {
    const contextBank = bank()
    vi.mocked(contextBank.replaceResearchSeed).mockImplementation(async request => {
      validateResearchSeedWriteRequest(request)
      return researchStatus({
        state: request.state,
        sourceCount: request.sources.length,
        chunkCount: request.chunks.length,
      })
    })

    const search = vi.fn(async (query: string) => query.includes('episode guide')
      ? [{ title: 'Episode guide', url: 'https://episodes.example/long-guide', snippet: 'Episode 2 summary' }]
      : [])
    const longEpisodeLine = `Episode 2: ${'important scene details '.repeat(40)}`
    expect(longEpisodeLine.length).toBeGreaterThan(500)

    const read = vi.fn(async (url: string) => ({
      url,
      title: 'Episode guide',
      site: 'episodes.example',
      text: longEpisodeLine,
      links: [],
      images: [],
    }))

    const result = await seedAnimeResearchForProject(project(), projectPath, {
      bank: contextBank,
      integrations: api(search as IntegrationsAPI['web']['search'], read as IntegrationsAPI['web']['read']),
      now: () => 12,
    })

    expect(result).toMatchObject({ status: 'ready' })
    const request = vi.mocked(contextBank.replaceResearchSeed).mock.calls[0]?.[0]
    const episodeChunk = request?.chunks.find(chunk => chunk.episodeNumber === 2)
    expect(episodeChunk).toBeDefined()
    expect(episodeChunk?.heading).toBe('Episode 2')
    expect(episodeChunk?.text).toBe(longEpisodeLine.trim())
    expect(episodeChunk?.text.length).toBeGreaterThan(500)
  })

  it('splits a single episode-list block into separate episode-numbered chunks', async () => {
    const contextBank = bank()
    const search = vi.fn(async (query: string) => query.includes('episode guide')
      ? [{ title: 'Episode guide', url: 'https://episodes.example/multi', snippet: 'Episodes 1 to 3' }]
      : [])
    const read = vi.fn(async (url: string) => ({
      url,
      title: 'Episode guide',
      site: 'episodes.example',
      text: [
        'Episode 1',
        'Mitsuki meets Hiyori and discovers the heart-shaped belt.',
        'Episode 2',
        'Hiyori explains the golden gate and the heart filling the next step.',
        'Episode 3',
        'Mitsuki deals with the next complication.',
      ].join('\n'),
      links: [],
      images: [],
    }))

    const result = await seedAnimeResearchForProject(project(), projectPath, {
      bank: contextBank,
      integrations: api(search as IntegrationsAPI['web']['search'], read as IntegrationsAPI['web']['read']),
      now: () => 13,
    })

    expect(result).toMatchObject({ status: 'ready' })
    const request = vi.mocked(contextBank.replaceResearchSeed).mock.calls[0]?.[0]
    const episode1 = request?.chunks.find(chunk => chunk.episodeNumber === 1)
    const episode2 = request?.chunks.find(chunk => chunk.episodeNumber === 2)
    const episode3 = request?.chunks.find(chunk => chunk.episodeNumber === 3)

    expect(episode1).toMatchObject({ heading: 'Episode 1' })
    expect(episode2).toMatchObject({ heading: 'Episode 2' })
    expect(episode3).toMatchObject({ heading: 'Episode 3' })
    expect(episode1?.text).toContain('heart-shaped belt')
    expect(episode1?.text).not.toContain('Episode 2')
    expect(episode2?.text).toContain('golden gate')
    expect(episode2?.text).not.toContain('Episode 3')
  })
})
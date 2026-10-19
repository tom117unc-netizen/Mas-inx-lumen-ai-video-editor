import { describe, expect, it, vi } from 'vitest'
import type { ContextBankAPI } from '@shared/context-bank'
import type { ContextBankResearchStatusResult } from '@shared/context-bank-research'
import type { IntegrationsAPI } from '@shared/integrations'
import { createEmptyProject } from '@/editor/new-project'
import { seedAnimeResearchForProject } from './anime-research'

const projectPath = 'D:\\Reviews\\show.lumen'

function reviewProject() {
  const project = createEmptyProject('Frieren', {}, { version: 1, showQuery: 'Frieren' })
  project.id = 'project-1'
  return project
}

function researchStatus(projectId = 'project-1', patch: Partial<ContextBankResearchStatusResult> = {}): ContextBankResearchStatusResult {
  return {
    projectId,
    sourceCount: 0,
    chunkCount: 0,
    priorCount: 0,
    warnings: [],
    ...patch,
  }
}

function bank(statusResult = researchStatus()) {
  return {
    getResearchStatus: vi.fn(async () => statusResult),
    setResearchState: vi.fn(async (request) => researchStatus(request.projectId, { state: request.state })),
    replaceResearchSeed: vi.fn(async (request) => researchStatus(request.projectId, {
      state: request.state,
      sourceCount: request.sources.length,
      chunkCount: request.chunks.length,
    })),
  } as unknown as ContextBankAPI
}

function integrations(result: Awaited<ReturnType<IntegrationsAPI['animeCatalog']['resolve']>>) {
  return {
    animeCatalog: { resolve: vi.fn(async () => result) },
    web: {
      search: vi.fn(async (query: string) => [
        { title: `${query} guide`, url: 'https://example.com/guide', snippet: 'Episode guide' },
        { title: 'duplicate', url: 'https://example.com/guide', snippet: 'duplicate' },
      ]),
      read: vi.fn(async () => ({
        url: 'https://example.com/guide',
        title: 'Episode guide',
        site: 'example.com',
        text: 'Overview of the cast.\n\nEpisode 2\nThe party reaches the village.\n\nEp. 5 contains the pudding scene.',
        links: [],
        images: [],
      })),
    },
  } as unknown as IntegrationsAPI
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

describe('anime research seeding lifecycle', () => {
  it('does absolutely nothing for an unsaved project or a generic non-anime project', async () => {
    const review = reviewProject()
    const generic = createEmptyProject('Generic')
    const reviewBank = bank()
    const reviewIntegrations = integrations(resolved)

    await expect(seedAnimeResearchForProject(review, null, { bank: reviewBank, integrations: reviewIntegrations })).resolves.toMatchObject({ status: 'skipped' })
    await expect(seedAnimeResearchForProject(generic, projectPath, { bank: reviewBank, integrations: reviewIntegrations })).resolves.toMatchObject({ status: 'skipped' })

    expect(reviewBank.getResearchStatus).not.toHaveBeenCalled()
    expect(reviewBank.setResearchState).not.toHaveBeenCalled()
    expect(reviewBank.replaceResearchSeed).not.toHaveBeenCalled()
    expect(reviewIntegrations.animeCatalog.resolve).not.toHaveBeenCalled()
    expect(reviewIntegrations.web.search).not.toHaveBeenCalled()
    expect(reviewIntegrations.web.read).not.toHaveBeenCalled()
  })

  it('resolves identity and writes one bounded research seed after the project has a durable path', async () => {
    const project = reviewProject()
    const contextBank = bank()
    const api = integrations(resolved)

    const result = await seedAnimeResearchForProject(project, projectPath, {
      bank: contextBank,
      integrations: api,
      now: () => 1_700_000_000_000,
    })

    expect(result).toMatchObject({ status: 'ready', identity: { externalId: '154587' } })
    expect(contextBank.getResearchStatus).toHaveBeenCalledTimes(1)
    expect(api.animeCatalog.resolve).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api.web.search).mock.calls.length).toBeLessThanOrEqual(4)
    expect(api.web.read).toHaveBeenCalledTimes(1)
    expect(contextBank.replaceResearchSeed).toHaveBeenCalledTimes(1)

    const request = vi.mocked(contextBank.replaceResearchSeed).mock.calls[0]?.[0]
    expect(request?.sources).toHaveLength(1)
    expect(request?.sources[0]?.text.length).toBeLessThanOrEqual(30_000)
    expect(request?.chunks.some((chunk) => chunk.episodeNumber === 2)).toBe(true)
    expect(request?.chunks.some((chunk) => chunk.episodeNumber === 5)).toBe(true)
    expect(request?.state).toMatchObject({ status: 'ready', identity: { externalId: '154587' } })
  })

  it('does not resolve or refetch when the bank is already ready', async () => {
    const project = reviewProject()
    const contextBank = bank(researchStatus('project-1', {
      state: {
        showQuery: 'Frieren',
        status: 'ready',
        updatedAt: 100,
        identity: { source: 'anilist', externalId: '154587', canonicalTitle: 'Frieren' },
      },
      sourceCount: 3,
      chunkCount: 20,
    }))
    const api = integrations(resolved)

    await expect(seedAnimeResearchForProject(project, projectPath, { bank: contextBank, integrations: api })).resolves.toMatchObject({ status: 'ready', reused: true })
    expect(api.animeCatalog.resolve).not.toHaveBeenCalled()
    expect(api.web.search).not.toHaveBeenCalled()
    expect(api.web.read).not.toHaveBeenCalled()
    expect(contextBank.replaceResearchSeed).not.toHaveBeenCalled()
  })

  it('stores ambiguous identity candidates and performs no detailed web seeding', async () => {
    const project = reviewProject()
    const contextBank = bank()
    const ambiguous = {
      status: 'needs-confirmation' as const,
      query: 'Spice and Wolf',
      candidates: [
        { source: 'anilist' as const, externalId: '1', canonicalTitle: 'Spice and Wolf', aliases: [], score: 1, year: 2008 },
        { source: 'anilist' as const, externalId: '2', canonicalTitle: 'Spice and Wolf', aliases: [], score: 1, year: 2024 },
      ],
    }
    const api = integrations(ambiguous)

    await expect(seedAnimeResearchForProject(project, projectPath, { bank: contextBank, integrations: api, now: () => 200 })).resolves.toMatchObject({ status: 'needs-confirmation' })
    expect(contextBank.setResearchState).toHaveBeenLastCalledWith(expect.objectContaining({
      state: expect.objectContaining({ status: 'needs-confirmation', candidates: expect.arrayContaining([expect.objectContaining({ externalId: '1' })]) }),
    }))
    expect(api.web.search).not.toHaveBeenCalled()
    expect(api.web.read).not.toHaveBeenCalled()
    expect(contextBank.replaceResearchSeed).not.toHaveBeenCalled()
  })

  it('records a retryable resolver failure without erasing an existing research seed', async () => {
    const project = reviewProject()
    const existing = researchStatus('project-1', {
      state: { showQuery: 'Frieren', status: 'error', error: 'older failure', updatedAt: 10 },
      sourceCount: 2,
      chunkCount: 9,
      priorCount: 1,
    })
    const contextBank = bank(existing)
    const api = integrations({ status: 'error', query: 'Frieren', candidates: [], retryable: true, error: 'rate limited' })

    await expect(seedAnimeResearchForProject(project, projectPath, {
      bank: contextBank,
      integrations: api,
      now: () => 300,
      allowRetry: true,
    })).resolves.toMatchObject({ status: 'error', retryable: true })

    expect(contextBank.setResearchState).toHaveBeenLastCalledWith(expect.objectContaining({
      state: expect.objectContaining({ status: 'error', error: 'rate limited' }),
    }))
    expect(contextBank.replaceResearchSeed).not.toHaveBeenCalled()
    expect(api.web.search).not.toHaveBeenCalled()
    expect(api.web.read).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { ContextBankAPI } from '@shared/context-bank'
import type { IntegrationsAPI } from '@shared/integrations'
import { createEmptyProject } from '@/editor/new-project'
import { seedAnimeResearchForProject, type AnimeResearchDependencies } from './anime-research'

describe('explicit anime research refresh', () => {
  it('reseeds a ready same-query research pack when an explicit refresh is requested', async () => {
    const project = createEmptyProject('Recently, My Sister Is Unusual', {}, {
      version: 1,
      showQuery: 'Saikin, Imouto no Yousu ga Chotto Okashiinda ga.',
      identity: {
        source: 'anilist',
        externalId: '17777',
        canonicalTitle: 'Recently, My Sister Is Unusual',
        year: 2014,
        format: 'TV',
        episodes: 12,
      },
    })
    project.id = 'project-1'

    const contextBank = {
      getResearchStatus: vi.fn(async () => ({
        projectId: 'project-1',
        state: {
          showQuery: 'Saikin, Imouto no Yousu ga Chotto Okashiinda ga.',
          status: 'ready' as const,
          updatedAt: 100,
          identity: {
            source: 'anilist' as const,
            externalId: '17777',
            canonicalTitle: 'Recently, My Sister Is Unusual',
            year: 2014,
            format: 'TV',
            episodes: 12,
          },
        },
        sourceCount: 2,
        chunkCount: 256,
        priorCount: 1,
        warnings: [],
      })),
      setResearchState: vi.fn(async (request: { projectId: string; state: unknown }) => ({
        projectId: request.projectId,
        state: request.state,
        sourceCount: 2,
        chunkCount: 256,
        priorCount: 1,
        warnings: [],
      })),
      replaceResearchSeed: vi.fn(async (request: { projectId: string; state: unknown; sources: unknown[]; chunks: unknown[] }) => ({
        projectId: request.projectId,
        state: request.state,
        sourceCount: request.sources.length,
        chunkCount: request.chunks.length,
        priorCount: 1,
        warnings: [],
      })),
    } as unknown as ContextBankAPI

    const integrations = {
      animeCatalog: { resolve: vi.fn() },
      web: {
        search: vi.fn(async (query: string) => query.includes('episode guide')
          ? [{ title: 'Episode guide', url: 'https://example.com/episodes', snippet: 'Episode 2 lore' }]
          : []),
        read: vi.fn(async () => ({
          url: 'https://example.com/episodes',
          title: 'Episode guide',
          site: 'example.com',
          text: 'Episode 2\nHiyori explains the supernatural situation.',
          links: [],
          images: [],
        })),
      },
    } as unknown as IntegrationsAPI

    const dependencies: AnimeResearchDependencies & { refreshReady: boolean } = {
      bank: contextBank,
      integrations,
      refreshReady: true,
      now: () => 200,
    }

    const result = await seedAnimeResearchForProject(project, 'D:\\Reviews\\review.lumen', dependencies)

    expect(result).toMatchObject({ status: 'ready' })
    expect(result).not.toMatchObject({ reused: true })
    expect(contextBank.setResearchState).toHaveBeenCalledWith(expect.objectContaining({
      state: expect.objectContaining({ status: 'seeding', updatedAt: 200 }),
    }))
    expect(contextBank.replaceResearchSeed).toHaveBeenCalledTimes(1)
    const request = vi.mocked(contextBank.replaceResearchSeed).mock.calls[0]?.[0]
    expect(request?.chunks.some(chunk => chunk.episodeNumber === 2)).toBe(true)
  })
})
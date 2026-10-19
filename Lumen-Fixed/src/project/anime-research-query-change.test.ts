import { describe, expect, it, vi } from 'vitest'
import type { ContextBankAPI } from '@shared/context-bank'
import type { IntegrationsAPI } from '@shared/integrations'
import { createEmptyProject } from '@/editor/new-project'
import { seedAnimeResearchForProject } from './anime-research'

describe('anime research show-query isolation', () => {
  it('does not reuse ready research from a different show query', async () => {
    const project = createEmptyProject('Spice and Wolf', {}, { version: 1, showQuery: 'Spice and Wolf' })
    project.id = 'project-1'

    const contextBank = {
      getResearchStatus: vi.fn(async () => ({
        projectId: 'project-1',
        state: {
          showQuery: 'Frieren',
          status: 'ready' as const,
          updatedAt: 100,
          identity: { source: 'anilist' as const, externalId: '154587', canonicalTitle: 'Frieren' },
        },
        sourceCount: 3,
        chunkCount: 10,
        priorCount: 1,
        warnings: [],
      })),
      setResearchState: vi.fn(async (request: { projectId: string; state: unknown }) => ({
        projectId: request.projectId,
        state: request.state,
        sourceCount: 3,
        chunkCount: 10,
        priorCount: 1,
        warnings: [],
      })),
      replaceResearchSeed: vi.fn(async (request: { projectId: string; state: unknown; sources: unknown[]; chunks: unknown[] }) => ({
        projectId: request.projectId,
        state: request.state,
        sourceCount: request.sources.length,
        chunkCount: request.chunks.length,
        priorCount: 0,
        warnings: [],
      })),
    } as unknown as ContextBankAPI

    const api = {
      animeCatalog: {
        resolve: vi.fn(async () => ({
          status: 'resolved' as const,
          query: 'Spice and Wolf',
          selected: {
            source: 'anilist' as const,
            externalId: '2966',
            canonicalTitle: 'Spice and Wolf',
            aliases: ['Ookami to Koushinryou'],
            score: 1,
            year: 2008,
            format: 'TV',
            episodes: 13,
          },
          candidates: [],
        })),
      },
      web: {
        search: vi.fn(async () => [{ title: 'guide', url: 'https://example.com/spice', snippet: 'episodes' }]),
        read: vi.fn(async () => ({
          url: 'https://example.com/spice',
          title: 'guide',
          site: 'example.com',
          text: 'Episode 1\nHolo meets Lawrence.',
          links: [],
          images: [],
        })),
      },
    } as unknown as IntegrationsAPI

    const result = await seedAnimeResearchForProject(project, 'D:\\Reviews\\spice.lumen', {
      bank: contextBank,
      integrations: api,
      now: () => 200,
    })

    expect(result).toMatchObject({ status: 'ready', identity: { externalId: '2966' } })
    expect(api.animeCatalog.resolve).toHaveBeenCalledWith('Spice and Wolf')
    expect(contextBank.replaceResearchSeed).toHaveBeenCalledTimes(1)
  })
})

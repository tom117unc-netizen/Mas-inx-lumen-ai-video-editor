import { describe, expect, it, vi } from 'vitest'
import type { ContextBankAPI } from '@shared/context-bank'
import type { ContextBankResearchStatusResult } from '@shared/context-bank-research'
import type { IntegrationsAPI } from '@shared/integrations'
import { createEmptyProject } from '@/editor/new-project'
import { seedAnimeResearchForProject } from './anime-research'

const projectPath = 'D:\\Reviews\\show.lumen'

function project() {
  const value = createEmptyProject('Recently My Sister Is Unusual', {}, {
    version: 1,
    showQuery: 'Saikin, Imouto no Yousu ga Chotto Okashiinda ga.',
  })
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

function api(search: IntegrationsAPI['web']['search'], read: IntegrationsAPI['web']['read']) {
  return {
    animeCatalog: {
      resolve: vi.fn(async () => ({
        status: 'resolved' as const,
        query: 'Saikin, Imouto no Yousu ga Chotto Okashiinda ga.',
        selected: {
          source: 'anilist' as const,
          externalId: '17777',
          canonicalTitle: 'Recently, My Sister Is Unusual',
          aliases: ['Saikin, Imouto no Yousu ga Chotto Okashiinda ga.'],
          score: 1,
          year: 2014,
          format: 'TV',
          episodes: 12,
        },
        candidates: [],
      })),
    },
    web: { search, read },
  } as unknown as IntegrationsAPI
}

describe('anime research Wikipedia episode rows', () => {
  it('splits flattened Wikipedia episode-table rows whose episode number is a bare leading number before the quoted title', async () => {
    const contextBank = bank()
    const search = vi.fn(async (query: string) => query.includes('episode guide')
      ? [{
          title: 'List of Recently, My Sister is Unusual episodes - Wikipedia',
          url: 'https://en.wikipedia.org/wiki/List_of_Recently,_My_Sister_is_Unusual_episodes',
          snippet: 'No. Title Original release date',
        }]
      : [])
    const read = vi.fn(async (url: string) => ({
      url,
      title: 'List of Recently, My Sister is Unusual episodes - Wikipedia',
      site: 'Wikipedia',
      text: [
        '## Anime',
        'No.Title Original release date',
        '1"Mitsuki SOS"',
        'Transliteration: "Mitsuki SOS" January 4, 2014',
        'Mitsuki meets Hiyori and discovers the heart-shaped belt.',
        '2"Shining Amidst the Storm"',
        'Transliteration: "Arashi no Naka de Kagayaite" January 11, 2014',
        'Mitsuki asks Hiyori who she is, then sees the golden gate while the heart on the belt fills.',
        '3"Heavy-Hanging Fruit"',
        'Transliteration: "Tawawana Kaijitsu" January 18, 2014',
        'Mitsuki and Hiyori deal with the next complication.',
      ].join('\n'),
      links: [],
      images: [],
    }))

    const result = await seedAnimeResearchForProject(project(), projectPath, {
      bank: contextBank,
      integrations: api(search as IntegrationsAPI['web']['search'], read as IntegrationsAPI['web']['read']),
      now: () => 20,
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
    expect(episode1?.text).not.toContain('Shining Amidst the Storm')
    expect(episode2?.text).toContain('golden gate')
    expect(episode2?.text).not.toContain('Heavy-Hanging Fruit')
  })
})

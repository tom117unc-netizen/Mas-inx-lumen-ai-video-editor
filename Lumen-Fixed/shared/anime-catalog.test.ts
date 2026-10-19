import { describe, expect, it } from 'vitest'
import {
  ANIME_CATALOG_CANDIDATES_MAX,
  chooseAnimeCatalogCandidate,
  normalizeAnimeCatalogTitle,
  type AnimeCatalogCandidateInput,
} from './anime-catalog'

const candidate = (patch: Partial<AnimeCatalogCandidateInput> = {}): AnimeCatalogCandidateInput => ({
  source: 'anilist',
  externalId: '1',
  canonicalTitle: 'Frieren: Beyond Journey’s End',
  aliases: ['Sousou no Frieren', 'Frieren at the Funeral'],
  year: 2023,
  format: 'TV',
  episodes: 28,
  ...patch,
})

describe('anime catalog identity scoring', () => {
  it('normalizes punctuation, apostrophes, case and whitespace for title matching', () => {
    expect(normalizeAnimeCatalogTitle('  Frieren: Beyond Journey’s End!! ')).toBe('frieren beyond journeys end')
    expect(normalizeAnimeCatalogTitle('SOUSOU   NO—FRIEREN')).toBe('sousou no frieren')
  })

  it('auto-selects one unambiguous exact canonical title match', () => {
    const result = chooseAnimeCatalogCandidate('frieren beyond journeys end', [
      candidate(),
      candidate({ externalId: '2', canonicalTitle: 'Frieren: The Journey Continues', aliases: [], year: 2026 }),
    ])
    expect(result.status).toBe('resolved')
    expect(result.selected?.externalId).toBe('1')
    expect(result.candidates[0]?.score).toBeGreaterThan(0.9)
  })

  it('treats an exact synonym match as strong enough to resolve when unique', () => {
    const result = chooseAnimeCatalogCandidate('Sousou no Frieren', [candidate()])
    expect(result.status).toBe('resolved')
    expect(result.selected?.externalId).toBe('1')
  })

  it('does not silently choose between two adaptations with the same exact title', () => {
    const result = chooseAnimeCatalogCandidate('Spice and Wolf', [
      candidate({ externalId: '10', canonicalTitle: 'Spice and Wolf', aliases: [], year: 2008, episodes: 13 }),
      candidate({ externalId: '20', canonicalTitle: 'Spice and Wolf', aliases: [], year: 2024, episodes: 25 }),
    ])
    expect(result.status).toBe('needs-confirmation')
    expect(result.selected).toBeUndefined()
    expect(result.candidates.map(item => item.externalId)).toEqual(['10', '20'])
  })

  it('uses year and format only as deterministic tie-break metadata rather than inventing constraints', () => {
    const result = chooseAnimeCatalogCandidate('Example Show', [
      candidate({ externalId: 'b', canonicalTitle: 'Example Show', aliases: [], year: 2020, format: 'MOVIE' }),
      candidate({ externalId: 'a', canonicalTitle: 'Example Show', aliases: [], year: 2010, format: 'TV' }),
    ])
    expect(result.status).toBe('needs-confirmation')
    expect(result.candidates.map(item => item.externalId)).toEqual(['a', 'b'])
  })

  it('caps candidate output deterministically', () => {
    const inputs = Array.from({ length: ANIME_CATALOG_CANDIDATES_MAX + 5 }, (_, index) => candidate({
      externalId: String(index + 1),
      canonicalTitle: `Show ${index + 1}`,
      aliases: [],
    }))
    const result = chooseAnimeCatalogCandidate('Show', inputs)
    expect(result.candidates).toHaveLength(ANIME_CATALOG_CANDIDATES_MAX)
  })
})

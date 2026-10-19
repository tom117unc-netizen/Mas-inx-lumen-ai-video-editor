import { describe, expect, it, vi } from 'vitest'
import { resolveAnimeCatalog } from './anime-catalog'

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const media = (patch: Record<string, unknown> = {}) => ({
  id: 154587,
  title: {
    romaji: 'Sousou no Frieren',
    english: 'Frieren: Beyond Journey’s End',
    native: '葬送のフリーレン',
  },
  synonyms: ['Frieren at the Funeral'],
  seasonYear: 2023,
  format: 'TV',
  episodes: 28,
  ...patch,
})

describe('AniList anime catalog adapter', () => {
  it('uses one bounded unauthenticated POST request to the official GraphQL endpoint', async () => {
    const fetcher = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => response({ data: { Page: { media: [media()] } } }))
    const result = await resolveAnimeCatalog('Frieren: Beyond Journey’s End', fetcher)

    expect(result.status).toBe('resolved')
    expect(result.selected).toMatchObject({ source: 'anilist', externalId: '154587', episodes: 28, format: 'TV' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://graphql.anilist.co')
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).has('authorization')).toBe(false)
    const payload = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> }
    expect(payload.variables).toMatchObject({ search: 'Frieren: Beyond Journey’s End' })
    expect(payload.query).toContain('Page')
    expect(payload.query).toContain('perPage')
  })

  it('shapes nullable AniList fields safely and keeps candidate output bounded', async () => {
    const many = Array.from({ length: 30 }, (_, index) => media({
      id: index + 1,
      title: { romaji: index === 0 ? 'Odd Show' : `Odd Show ${index}`, english: null, native: null },
      synonyms: index === 0 ? null : [],
      seasonYear: null,
      format: null,
      episodes: null,
    }))
    const fetcher = vi.fn(async () => response({ data: { Page: { media: many } } }))
    const result = await resolveAnimeCatalog('Odd Show', fetcher)

    expect(result.candidates.length).toBeLessThanOrEqual(12)
    expect(result.candidates[0]).toMatchObject({ externalId: '1', canonicalTitle: 'Odd Show', aliases: [] })
    expect(result.candidates[0]).not.toHaveProperty('year')
    expect(result.candidates[0]).not.toHaveProperty('episodes')
  })

  it('returns needs-confirmation rather than merging or guessing ambiguous adaptations', async () => {
    const fetcher = vi.fn(async () => response({ data: { Page: { media: [
      media({ id: 1, title: { romaji: 'Spice and Wolf', english: 'Spice and Wolf', native: null }, synonyms: [], seasonYear: 2008, episodes: 13 }),
      media({ id: 2, title: { romaji: 'Spice and Wolf', english: 'Spice and Wolf', native: null }, synonyms: [], seasonYear: 2024, episodes: 25 }),
    ] } } }))

    const result = await resolveAnimeCatalog('Spice and Wolf', fetcher)
    expect(result.status).toBe('needs-confirmation')
    expect(result.selected).toBeUndefined()
    expect(result.candidates).toHaveLength(2)
  })

  it('maps rate limits and transport failures to retryable errors without a guessed identity', async () => {
    const limited = await resolveAnimeCatalog('Frieren', vi.fn(async () => response({ errors: [{ message: 'Too many requests' }] }, 429)))
    expect(limited).toMatchObject({ status: 'error', retryable: true })
    expect(limited.selected).toBeUndefined()

    const offline = await resolveAnimeCatalog('Frieren', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(offline).toMatchObject({ status: 'error', retryable: true })
    expect(offline.selected).toBeUndefined()
  })

  it('treats malformed or GraphQL-error responses as errors instead of silently selecting anything', async () => {
    const graphql = await resolveAnimeCatalog('Frieren', vi.fn(async () => response({ errors: [{ message: 'Bad query' }] })))
    expect(graphql).toMatchObject({ status: 'error' })
    expect(graphql.selected).toBeUndefined()

    const malformed = await resolveAnimeCatalog('Frieren', vi.fn(async () => response({ data: { Page: { media: 'not-an-array' } } })))
    expect(malformed).toMatchObject({ status: 'error' })
    expect(malformed.selected).toBeUndefined()
  })
})

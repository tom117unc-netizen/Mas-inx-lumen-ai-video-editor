import {
  ANIME_CATALOG_CANDIDATES_MAX,
  ANIME_CATALOG_QUERY_MAX,
  chooseAnimeCatalogCandidate,
  normalizeAnimeCatalogTitle,
  type AnimeCatalogCandidateInput,
  type AnimeCatalogErrorResult,
  type AnimeCatalogResolveResult,
} from '../../shared/anime-catalog'

export const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co'
const REQUEST_TIMEOUT_MS = 10_000

const QUERY = `
query LumenAnimeIdentity($search: String!) {
  Page(page: 1, perPage: ${ANIME_CATALOG_CANDIDATES_MAX}) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { romaji english native }
      synonyms
      seasonYear
      format
      episodes
    }
  }
}`

type FetchLike = typeof fetch

interface AniListMedia {
  id?: unknown
  title?: { romaji?: unknown; english?: unknown; native?: unknown } | null
  synonyms?: unknown
  seasonYear?: unknown
  format?: unknown
  episodes?: unknown
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function year(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1900 && value <= 2200 ? value : undefined
}

function shapeMedia(value: unknown): AnimeCatalogCandidateInput | null {
  if (!value || typeof value !== 'object') return null
  const item = value as AniListMedia
  const externalId = typeof item.id === 'number' || typeof item.id === 'string' ? String(item.id) : ''
  if (!externalId) return null

  const titles = item.title && typeof item.title === 'object' ? item.title : {}
  const english = text(titles.english)
  const romaji = text(titles.romaji)
  const native = text(titles.native)
  const canonicalTitle = english ?? romaji ?? native
  if (!canonicalTitle) return null

  const rawSynonyms = Array.isArray(item.synonyms) ? item.synonyms.map(text).filter((entry): entry is string => Boolean(entry)) : []
  const aliases = [romaji, english, native, ...rawSynonyms]
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry, index, all) => {
      const normalized = normalizeAnimeCatalogTitle(entry)
      return normalized !== normalizeAnimeCatalogTitle(canonicalTitle)
        && all.findIndex(other => normalizeAnimeCatalogTitle(other) === normalized) === index
    })

  const seasonYear = year(item.seasonYear)
  const episodes = positiveInteger(item.episodes)
  const format = text(item.format)
  return {
    source: 'anilist',
    externalId,
    canonicalTitle,
    aliases,
    ...(seasonYear === undefined ? {} : { year: seasonYear }),
    ...(format === undefined ? {} : { format }),
    ...(episodes === undefined ? {} : { episodes }),
  }
}

function errorResult(query: string, error: string, retryable: boolean): AnimeCatalogErrorResult {
  return { status: 'error', query, candidates: [], retryable, error }
}

function graphqlErrorMessage(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  const errors = (value as { errors?: unknown }).errors
  if (!Array.isArray(errors) || !errors.length) return undefined
  const first = errors[0]
  if (first && typeof first === 'object' && typeof (first as { message?: unknown }).message === 'string') {
    return (first as { message: string }).message.slice(0, 1_000)
  }
  return 'AniList returned a GraphQL error.'
}

/**
 * Resolves only catalogue identity. Episode events and timestamps are never
 * inferred here; those remain research/verified-media responsibilities.
 */
export async function resolveAnimeCatalog(query: string, fetcher: FetchLike = fetch): Promise<AnimeCatalogResolveResult> {
  const cleanQuery = String(query ?? '').trim().slice(0, ANIME_CATALOG_QUERY_MAX)
  if (!cleanQuery) return errorResult(cleanQuery, 'Anime title is required.', false)

  let response: Response
  try {
    response = await fetcher(ANILIST_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { search: cleanQuery } }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return errorResult(cleanQuery, error instanceof Error ? error.message.slice(0, 1_000) : 'AniList request failed.', true)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return errorResult(cleanQuery, `AniList returned an unreadable response (${response.status}).`, response.status === 429 || response.status >= 500)
  }

  if (!response.ok) {
    return errorResult(
      cleanQuery,
      graphqlErrorMessage(body) ?? `AniList request failed with HTTP ${response.status}.`,
      response.status === 408 || response.status === 429 || response.status >= 500,
    )
  }

  const graphError = graphqlErrorMessage(body)
  if (graphError) return errorResult(cleanQuery, graphError, false)

  const media = (body as { data?: { Page?: { media?: unknown } | null } } | null)?.data?.Page?.media
  if (!Array.isArray(media)) return errorResult(cleanQuery, 'AniList returned a malformed media list.', false)

  const candidates = media
    .map(shapeMedia)
    .filter((item): item is AnimeCatalogCandidateInput => Boolean(item))
    .slice(0, ANIME_CATALOG_CANDIDATES_MAX)

  return chooseAnimeCatalogCandidate(cleanQuery, candidates)
}

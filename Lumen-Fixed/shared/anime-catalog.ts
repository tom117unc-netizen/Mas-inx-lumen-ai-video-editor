export const ANIME_CATALOG_CANDIDATES_MAX = 12
export const ANIME_CATALOG_QUERY_MAX = 500
export const ANIME_CATALOG_TITLE_MAX = 500
export const ANIME_CATALOG_ALIASES_MAX = 24

export interface AnimeCatalogCandidateInput {
  source: 'anilist'
  externalId: string
  canonicalTitle: string
  aliases: string[]
  year?: number
  format?: string
  episodes?: number
}

export interface AnimeCatalogCandidate extends AnimeCatalogCandidateInput {
  score: number
}

export interface AnimeCatalogResolvedResult {
  status: 'resolved'
  query: string
  selected: AnimeCatalogCandidate
  candidates: AnimeCatalogCandidate[]
}

export interface AnimeCatalogNeedsConfirmationResult {
  status: 'needs-confirmation'
  query: string
  candidates: AnimeCatalogCandidate[]
  selected?: undefined
}

export interface AnimeCatalogErrorResult {
  status: 'error'
  query: string
  candidates: []
  retryable: boolean
  error: string
  selected?: undefined
}

export type AnimeCatalogResolveResult =
  | AnimeCatalogResolvedResult
  | AnimeCatalogNeedsConfirmationResult
  | AnimeCatalogErrorResult

function boundedText(value: string, max: number) {
  return value.trim().slice(0, max)
}

/** Stable title form used only for matching, never for display. */
export function normalizeAnimeCatalogTitle(value: string) {
  return boundedText(String(value ?? ''), ANIME_CATALOG_TITLE_MAX)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’'`´]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function tokens(value: string) {
  const normalized = normalizeAnimeCatalogTitle(value)
  return normalized ? normalized.split(' ') : []
}

function similarity(query: string, title: string) {
  if (!query || !title) return 0
  if (query === title) return 1
  if (title.startsWith(`${query} `) || title.endsWith(` ${query}`)) return 0.82
  if (title.includes(query) || query.includes(title)) return 0.78

  const q = new Set(tokens(query))
  const t = new Set(tokens(title))
  if (!q.size || !t.size) return 0
  let overlap = 0
  for (const token of q) if (t.has(token)) overlap++
  const union = new Set([...q, ...t]).size
  return union ? Math.min(0.74, (overlap / union) * 0.74) : 0
}

function scoreCandidate(query: string, candidate: AnimeCatalogCandidateInput) {
  const normalizedQuery = normalizeAnimeCatalogTitle(query)
  const canonical = normalizeAnimeCatalogTitle(candidate.canonicalTitle)
  if (canonical === normalizedQuery && normalizedQuery) return 1

  let best = similarity(normalizedQuery, canonical)
  for (const alias of candidate.aliases) {
    const normalizedAlias = normalizeAnimeCatalogTitle(alias)
    if (normalizedAlias === normalizedQuery && normalizedQuery) return 0.98
    best = Math.max(best, similarity(normalizedQuery, normalizedAlias) * 0.97)
  }
  return Math.max(0, Math.min(1, Number(best.toFixed(6))))
}

function compareCandidates(a: AnimeCatalogCandidate, b: AnimeCatalogCandidate) {
  if (b.score !== a.score) return b.score - a.score
  const ay = a.year ?? Number.MAX_SAFE_INTEGER
  const by = b.year ?? Number.MAX_SAFE_INTEGER
  if (ay !== by) return ay - by
  const af = a.format ?? ''
  const bf = b.format ?? ''
  const format = af.localeCompare(bf)
  if (format) return format
  const title = a.canonicalTitle.localeCompare(b.canonicalTitle)
  if (title) return title
  return a.externalId.localeCompare(b.externalId, undefined, { numeric: true })
}

function sanitizeCandidate(input: AnimeCatalogCandidateInput): AnimeCatalogCandidateInput | null {
  if (input.source !== 'anilist') return null
  const externalId = boundedText(String(input.externalId ?? ''), 128)
  const canonicalTitle = boundedText(String(input.canonicalTitle ?? ''), ANIME_CATALOG_TITLE_MAX)
  if (!externalId || !canonicalTitle) return null
  const aliases = [...new Set((Array.isArray(input.aliases) ? input.aliases : [])
    .map(alias => boundedText(String(alias ?? ''), ANIME_CATALOG_TITLE_MAX))
    .filter(Boolean))]
    .slice(0, ANIME_CATALOG_ALIASES_MAX)
  const year = Number.isInteger(input.year) && (input.year as number) >= 1900 && (input.year as number) <= 2200 ? input.year : undefined
  const episodes = Number.isInteger(input.episodes) && (input.episodes as number) > 0 ? input.episodes : undefined
  const format = typeof input.format === 'string' && input.format.trim() ? input.format.trim().slice(0, 128) : undefined
  return {
    source: 'anilist',
    externalId,
    canonicalTitle,
    aliases,
    ...(year === undefined ? {} : { year }),
    ...(format === undefined ? {} : { format }),
    ...(episodes === undefined ? {} : { episodes }),
  }
}

/**
 * Scores candidates but deliberately refuses to auto-select close/exact ties.
 * Year/format only stabilize ordering; they never make an ambiguous adaptation
 * become an automatic selection.
 */
export function chooseAnimeCatalogCandidate(
  query: string,
  inputs: readonly AnimeCatalogCandidateInput[],
): AnimeCatalogResolvedResult | AnimeCatalogNeedsConfirmationResult {
  const cleanQuery = boundedText(String(query ?? ''), ANIME_CATALOG_QUERY_MAX)
  const ranked = inputs
    .map(sanitizeCandidate)
    .filter((item): item is AnimeCatalogCandidateInput => Boolean(item))
    .map(item => ({ ...item, score: scoreCandidate(cleanQuery, item) }))
    .sort(compareCandidates)
    .slice(0, ANIME_CATALOG_CANDIDATES_MAX)

  const top = ranked[0]
  const second = ranked[1]
  const unambiguous = Boolean(top && top.score >= 0.95 && (!second || top.score - second.score >= 0.05))
  if (top && unambiguous) return { status: 'resolved', query: cleanQuery, selected: top, candidates: ranked }
  return { status: 'needs-confirmation', query: cleanQuery, candidates: ranked }
}

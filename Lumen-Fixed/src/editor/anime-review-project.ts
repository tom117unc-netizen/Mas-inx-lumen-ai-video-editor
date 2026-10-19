import type { Project } from './types'

export interface AnimeReviewIdentity {
  source: 'anilist'
  externalId: string
  canonicalTitle: string
  year?: number
  format?: string
  episodes?: number
}

/**
 * Small, portable intent that belongs in the .lumen document. Detailed web
 * research, claims, excerpts and confidence stay in the project-local Context
 * Bank instead of inflating the canonical project file.
 */
export interface AnimeReviewSetup {
  version: 1
  showQuery: string
  identity?: AnimeReviewIdentity
}

declare module './types' {
  interface Project {
    animeReview?: AnimeReviewSetup
  }
}

const SHOW_QUERY_MAX = 300
const EXTERNAL_ID_MAX = 128
const TITLE_MAX = 300
const FORMAT_MAX = 80

function text(value: unknown, max: number) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed.length <= max ? trimmed : undefined
}

function optionalInteger(value: unknown, min: number, max: number) {
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined
}

function sanitizeIdentity(value: unknown): AnimeReviewIdentity | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (input.source !== 'anilist') return undefined
  const externalId = text(input.externalId, EXTERNAL_ID_MAX)
  const canonicalTitle = text(input.canonicalTitle, TITLE_MAX)
  if (!externalId || !canonicalTitle) return undefined

  const year = optionalInteger(input.year, 1900, 2200)
  if (input.year !== undefined && year === undefined) return undefined
  const episodes = optionalInteger(input.episodes, 1, 100_000)
  if (input.episodes !== undefined && episodes === undefined) return undefined
  const format = input.format === undefined ? undefined : text(input.format, FORMAT_MAX)
  if (input.format !== undefined && !format) return undefined

  return {
    source: 'anilist',
    externalId,
    canonicalTitle,
    ...(year === undefined ? {} : { year }),
    ...(format === undefined ? {} : { format }),
    ...(episodes === undefined ? {} : { episodes }),
  }
}

/** Whitelist-normalizes persisted or external setup data. Unknown fields die here. */
export function sanitizeAnimeReviewSetup(value: unknown): AnimeReviewSetup | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  if (input.version !== 1) return undefined
  const showQuery = text(input.showQuery, SHOW_QUERY_MAX)
  if (!showQuery) return undefined
  const identity = input.identity === undefined ? undefined : sanitizeIdentity(input.identity)
  return {
    version: 1,
    showQuery,
    ...(identity ? { identity } : {}),
  }
}

/**
 * Normalizes the optional review setup whenever a project enters the editor.
 * The project itself remains authoritative; this merely prevents malformed or
 * stale research-shaped payloads from travelling in the canonical document.
 */
export function normalizeAnimeReviewProject<T extends Project>(project: T): T {
  const holder = project as T & { animeReview?: unknown }
  const normalized = sanitizeAnimeReviewSetup(holder.animeReview)
  if (normalized) holder.animeReview = normalized
  else delete holder.animeReview
  return project
}

import type { Project } from './types'

export type AnimeEpisodeMatchKind = 'season-episode' | 'episode-word' | 'ep-prefix' | 'e-prefix'

export interface AnimeEpisodeLabelMatch {
  episodeNumber: number
  seasonNumber?: number
  matchedBy: AnimeEpisodeMatchKind
  confidence: number
  matchedText: string
}

export interface AnimeEpisodeAssetMatch extends AnimeEpisodeLabelMatch {
  assetId: string
  assetName: string
}

const MAX_EPISODE = 10_000
const MAX_SEASON = 1_000

interface Pattern {
  kind: AnimeEpisodeMatchKind
  confidence: number
  regex: RegExp
  seasonGroup?: number
  episodeGroup: number
}

const PATTERNS: readonly Pattern[] = [
  {
    kind: 'season-episode',
    confidence: 1,
    regex: /(?:^|[\s._-])S(\d{1,3})[\s._-]*E(\d{1,4})(?=$|[\s._-])/i,
    seasonGroup: 1,
    episodeGroup: 2,
  },
  {
    kind: 'episode-word',
    confidence: 0.99,
    regex: /(?:^|[\s._-])Episode[\s._-]*(\d{1,4})(?=$|[\s._-])/i,
    episodeGroup: 1,
  },
  {
    kind: 'ep-prefix',
    confidence: 0.98,
    regex: /(?:^|[\s._-])EP[\s._-]*(\d{1,4})(?=$|[\s._-])/i,
    episodeGroup: 1,
  },
  {
    kind: 'e-prefix',
    confidence: 0.96,
    regex: /(?:^|[\s._-])E[\s._-]*(\d{1,4})(?=$|[\s._-])/i,
    episodeGroup: 1,
  },
]

function positiveInteger(value: string | undefined, max: number) {
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= max ? parsed : undefined
}

/**
 * Parses only labels that explicitly mark an episode. Bare numbers are
 * intentionally ignored because years, resolutions, release revisions and
 * codec tags are common in anime filenames.
 */
export function parseAnimeEpisodeLabel(label: string): AnimeEpisodeLabelMatch | null {
  for (const pattern of PATTERNS) {
    const match = pattern.regex.exec(label)
    if (!match) continue
    const episodeNumber = positiveInteger(match[pattern.episodeGroup], MAX_EPISODE)
    if (episodeNumber === undefined) continue
    const seasonNumber = pattern.seasonGroup === undefined
      ? undefined
      : positiveInteger(match[pattern.seasonGroup], MAX_SEASON)
    if (pattern.seasonGroup !== undefined && seasonNumber === undefined) continue
    return {
      episodeNumber,
      ...(seasonNumber === undefined ? {} : { seasonNumber }),
      matchedBy: pattern.kind,
      confidence: pattern.confidence,
      matchedText: match[0].trim(),
    }
  }
  return null
}

/**
 * Builds a cheap metadata-only episode map. It never reads media bytes and it
 * deliberately keeps multiple files for the same episode as separate entries.
 */
export function mapAnimeEpisodeAssets(project: Project): AnimeEpisodeAssetMatch[] {
  const matches: AnimeEpisodeAssetMatch[] = []
  for (const asset of Object.values(project.assets ?? {})) {
    if (asset.kind !== 'video' || asset.source.missing) continue
    const labels = asset.source.type === 'file'
      ? [asset.source.fileName, asset.name]
      : [asset.name]
    let parsed: AnimeEpisodeLabelMatch | null = null
    for (const label of labels) {
      parsed = parseAnimeEpisodeLabel(label)
      if (parsed) break
    }
    if (!parsed) continue
    matches.push({ assetId: asset.id, assetName: asset.name, ...parsed })
  }
  return matches.sort((a, b) =>
    a.episodeNumber - b.episodeNumber
    || (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0)
    || a.assetId.localeCompare(b.assetId))
}

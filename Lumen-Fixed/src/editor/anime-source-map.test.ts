import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './new-project'
import type { Asset } from './types'
import { mapAnimeEpisodeAssets, parseAnimeEpisodeLabel } from './anime-source-map'

function episodeAsset(id: string, fileName: string, name = fileName): Asset {
  return {
    id,
    name,
    kind: 'video',
    duration: 1_440,
    source: {
      type: 'file',
      url: `file:///${fileName}`,
      path: `D:\\Anime\\${fileName}`,
      mime: 'video/x-matroska',
      fileName,
      size: 100,
      mtime: 1,
    },
    addedAt: 1,
  }
}

describe('parseAnimeEpisodeLabel', () => {
  it('parses only explicit episode naming forms with explainable confidence', () => {
    expect(parseAnimeEpisodeLabel('Frieren S01E02 1080p.mkv')).toMatchObject({ episodeNumber: 2, seasonNumber: 1, matchedBy: 'season-episode', confidence: 1 })
    expect(parseAnimeEpisodeLabel('Frieren Episode 02.mkv')).toMatchObject({ episodeNumber: 2, matchedBy: 'episode-word' })
    expect(parseAnimeEpisodeLabel('Frieren EP02.mkv')).toMatchObject({ episodeNumber: 2, matchedBy: 'ep-prefix' })
    expect(parseAnimeEpisodeLabel('Frieren E02.mkv')).toMatchObject({ episodeNumber: 2, matchedBy: 'e-prefix' })
  })

  it('does not treat arbitrary bare numbers, resolutions, years or season numbers as episodes', () => {
    expect(parseAnimeEpisodeLabel('[SubsPlease] Frieren - 02 (1080p).mkv')).toBeNull()
    expect(parseAnimeEpisodeLabel('Frieren 2023 1080p.mkv')).toBeNull()
    expect(parseAnimeEpisodeLabel('Frieren Season 2 Trailer.mkv')).toBeNull()
    expect(parseAnimeEpisodeLabel('1080p.mkv')).toBeNull()
  })
})

describe('mapAnimeEpisodeAssets', () => {
  it('maps imported video files deterministically and keeps duplicate episode candidates separate', () => {
    const project = createEmptyProject('Frieren')
    project.assets = {
      a: episodeAsset('a', 'Frieren Episode 02.mkv'),
      b: episodeAsset('b', 'Frieren S01E02 Director Cut.mkv'),
      c: episodeAsset('c', 'Frieren EP03.mkv'),
      ignored: episodeAsset('ignored', 'Frieren - 04.mkv'),
    }

    expect(mapAnimeEpisodeAssets(project)).toEqual([
      expect.objectContaining({ assetId: 'a', episodeNumber: 2, matchedBy: 'episode-word' }),
      expect.objectContaining({ assetId: 'b', episodeNumber: 2, seasonNumber: 1, matchedBy: 'season-episode' }),
      expect.objectContaining({ assetId: 'c', episodeNumber: 3, matchedBy: 'ep-prefix' }),
    ])
  })

  it('ignores missing media and non-video assets even when their labels look episodic', () => {
    const project = createEmptyProject('Frieren')
    const missing = episodeAsset('missing', 'Frieren Episode 05.mkv')
    if (missing.source.type === 'file') missing.source.missing = true
    const image = { ...episodeAsset('image', 'Frieren Episode 06.png'), kind: 'image' as const }
    project.assets = { missing, image }

    expect(mapAnimeEpisodeAssets(project)).toEqual([])
  })
})

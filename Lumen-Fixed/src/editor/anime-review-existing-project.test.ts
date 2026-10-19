import { describe, expect, it } from 'vitest'
import { animeReviewSetupForExistingProject } from './anime-review-project'

describe('animeReviewSetupForExistingProject', () => {
  const identity = {
    source: 'anilist' as const,
    externalId: '154587',
    canonicalTitle: 'Frieren: Beyond Journey’s End',
    year: 2023,
  }

  it('adds review intent to an old generic project from an explicit title', () => {
    expect(animeReviewSetupForExistingProject(undefined, '  Frieren  ')).toEqual({
      version: 1,
      showQuery: 'Frieren',
    })
  })

  it('preserves resolved identity when the normalized query is unchanged', () => {
    expect(animeReviewSetupForExistingProject(
      { version: 1, showQuery: 'Frieren', identity },
      ' Frieren ',
    )).toEqual({ version: 1, showQuery: 'Frieren', identity })
  })

  it('drops stale identity when the show query changes and rejects invalid titles', () => {
    expect(animeReviewSetupForExistingProject(
      { version: 1, showQuery: 'Frieren', identity },
      'Spice and Wolf',
    )).toEqual({ version: 1, showQuery: 'Spice and Wolf' })
    expect(animeReviewSetupForExistingProject(undefined, '   ')).toBeUndefined()
    expect(animeReviewSetupForExistingProject(undefined, 'x'.repeat(301))).toBeUndefined()
  })
})

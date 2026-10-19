import { describe, expect, it } from 'vitest'
import { animeReviewProjectFromTitle } from './anime-review-project'

describe('animeReviewProjectFromTitle', () => {
  it('keeps a blank title on the ordinary project path', () => {
    expect(animeReviewProjectFromTitle('   ')).toEqual({ name: 'Untitled' })
  })

  it('trims a show title into the project name and compact anime-review setup', () => {
    expect(animeReviewProjectFromTitle('  Frieren: Beyond Journey’s End  ')).toEqual({
      name: 'Frieren: Beyond Journey’s End',
      animeReview: { version: 1, showQuery: 'Frieren: Beyond Journey’s End' },
    })
  })

  it('falls back to the ordinary path when the title cannot fit the portable setup contract', () => {
    expect(animeReviewProjectFromTitle('x'.repeat(301))).toEqual({ name: 'Untitled' })
  })
})

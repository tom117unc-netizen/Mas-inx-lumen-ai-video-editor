import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './new-project'
import { migrateProject } from './store'
import type { Project } from './types'

describe('anime review project setup', () => {
  it('leaves ordinary projects unchanged when no show is supplied', () => {
    const project = createEmptyProject('Ordinary')
    expect(project.name).toBe('Ordinary')
    expect(project.animeReview).toBeUndefined()
  })

  it('stores only a trimmed versioned show query for a new anime review project', () => {
    const project = createEmptyProject('Review', {}, { version: 1, showQuery: '  Frieren: Beyond Journey’s End  ' })
    expect(project.animeReview).toEqual({
      version: 1,
      showQuery: 'Frieren: Beyond Journey’s End',
    })
    expect(JSON.stringify(project.animeReview)).not.toMatch(/source|claim|research|url|excerpt|confidence/i)
  })

  it('accepts a compact confirmed identity but no fetched research payload', () => {
    const project = createEmptyProject('Review', {}, {
      version: 1,
      showQuery: 'Frieren',
      identity: {
        source: 'anilist',
        externalId: '154587',
        canonicalTitle: 'Frieren: Beyond Journey’s End',
        year: 2023,
        format: 'TV',
        episodes: 28,
      },
    })
    expect(project.animeReview?.identity).toEqual({
      source: 'anilist',
      externalId: '154587',
      canonicalTitle: 'Frieren: Beyond Journey’s End',
      year: 2023,
      format: 'TV',
      episodes: 28,
    })
  })

  it('migrates old projects without inventing anime review state', () => {
    const old = createEmptyProject('Old') as Project
    delete (old as Project & { animeReview?: unknown }).animeReview
    expect(migrateProject(old).animeReview).toBeUndefined()
  })

  it('sanitizes malformed anime review state during migration', () => {
    const project = createEmptyProject('Review') as Project & { animeReview?: unknown }
    project.animeReview = { version: 99, showQuery: '   ' }
    expect(migrateProject(project as Project).animeReview).toBeUndefined()
  })
})

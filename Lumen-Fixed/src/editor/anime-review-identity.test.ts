import { describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from './new-project'
import { getProject, recordAnimeReviewIdentity, subscribeCommittedEdits, useEditor } from './store'

const identity = {
  source: 'anilist' as const,
  externalId: '154587',
  canonicalTitle: 'Frieren: Beyond Journey’s End',
  year: 2023,
  format: 'TV',
  episodes: 28,
}

describe('recordAnimeReviewIdentity', () => {
  it('records confirmed identity as dirty canonical project metadata without creating an undo step', () => {
    const project = createEmptyProject('Frieren', {}, { version: 1, showQuery: 'Frieren' })
    project.id = 'project-1'
    useEditor.getState().loadProject(project)
    const beforeVersion = useEditor.getState().version
    const beforePast = useEditor.getState().past
    const listener = vi.fn()
    const unsubscribe = subscribeCommittedEdits(listener)

    expect(recordAnimeReviewIdentity('project-1', 'Frieren', identity)).toBe(true)

    unsubscribe()
    expect(getProject().animeReview?.identity).toEqual(identity)
    expect(useEditor.getState().version).toBe(beforeVersion + 1)
    expect(useEditor.getState().past).toBe(beforePast)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ kind: 'dispatch', revision: beforeVersion + 1 }))
  })

  it('refuses stale projects or queries and is a no-op when the same identity is already present', () => {
    const project = createEmptyProject('Frieren', {}, { version: 1, showQuery: 'Frieren', identity })
    project.id = 'project-1'
    useEditor.getState().loadProject(project)
    const version = useEditor.getState().version

    expect(recordAnimeReviewIdentity('other-project', 'Frieren', identity)).toBe(false)
    expect(recordAnimeReviewIdentity('project-1', 'Other Show', identity)).toBe(false)
    expect(recordAnimeReviewIdentity('project-1', 'Frieren', identity)).toBe(false)
    expect(useEditor.getState().version).toBe(version)
  })
})

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  project: {
    id: 'project-1',
    animeReview: { version: 1, showQuery: 'Frieren' },
  },
  setState: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  flush: vi.fn(async () => {}),
  recordIdentity: vi.fn(),
  seed: vi.fn(async (_project: unknown, _projectPath: string, dependencies?: { allowRetry?: boolean }) => (
    dependencies?.allowRetry
      ? { status: 'ready' as const }
      : { status: 'error' as const, error: 'older failure', retryable: true }
  )),
}))

vi.mock('@/editor/store', () => ({
  getProject: () => mocks.project,
  useEditor: {
    getState: () => ({ project: mocks.project, version: 1 }),
    setState: mocks.setState,
    subscribe: mocks.subscribe,
  },
}))

vi.mock('@/project/session', () => ({
  useSession: { getState: () => ({ path: 'D:\\Reviews\\review.lumen' }) },
}))

vi.mock('@/project/context-bank-runtime', () => ({
  flushContextBankWrites: mocks.flush,
  recordResolvedAnimeResearchIdentity: mocks.recordIdentity,
}))

vi.mock('@/project/anime-research', () => ({
  seedAnimeResearchForProject: mocks.seed,
}))

vi.mock('@/lib/platform', () => ({
  desktop: { contextBank: {} },
  integrations: {},
}))

import { CONTEXT_BANK_RESEARCH_TOOLS } from './context-bank-research'

describe('configure_anime_review_project retry path', () => {
  it('forces a reseed when the same show already has a cached retryable research error', async () => {
    const configure = CONTEXT_BANK_RESEARCH_TOOLS.find(tool => tool.name === 'configure_anime_review_project')!

    const result = await configure.run({ show_query: 'Frieren' })

    expect(result).toMatchObject({
      configured: true,
      changed: false,
      show_query: 'Frieren',
      research: { status: 'ready' },
    })
    expect(mocks.seed).toHaveBeenCalledTimes(1)
    expect(mocks.seed.mock.calls[0]?.[2]).toMatchObject({ allowRetry: true })
  })
})

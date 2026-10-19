import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  path: 'D:\\Reviews\\review.lumen' as string | null,
  projectId: 'project-1',
  transcript: [{ start: 1, end: 2, text: 'hello' }],
  reads: 0,
  flush: vi.fn(async () => {}),
  putTranscript: vi.fn(async (request: unknown) => request),
}))

vi.mock('@/editor/store', async importOriginal => {
  const actual = await importOriginal<typeof import('@/editor/store')>()
  return {
    ...actual,
    getProject: () => ({
      id: mocks.projectId,
      assets: {
        'asset-1': {
          id: 'asset-1',
          transcript: mocks.transcript,
        },
      },
    }),
  }
})
vi.mock('@/project/session', () => ({ useSession: { getState: () => ({ path: mocks.path }) } }))
vi.mock('@/project/context-bank-runtime', () => ({ flushContextBankWrites: mocks.flush }))
vi.mock('@/lib/platform', () => ({
  desktop: {
    contextBank: {
      getTranscript: vi.fn(async (request: { assetId: string }) => {
        mocks.reads += 1
        if (mocks.reads === 1) {
          return {
            projectId: mocks.projectId,
            assetId: request.assetId,
            fingerprint: 'a'.repeat(64),
            found: false,
            words: [],
            segments: [],
            truncated: false,
            warnings: [],
          }
        }
        return {
          projectId: mocks.projectId,
          assetId: request.assetId,
          fingerprint: 'a'.repeat(64),
          found: true,
          provider: 'lumen-project',
          model: 'asset-transcript',
          analysisVersion: 'asset-transcript-backfill-v1',
          words: [],
          segments: mocks.transcript,
          truncated: false,
          warnings: [],
        }
      }),
      putTranscript: mocks.putTranscript,
      getObservations: vi.fn(),
      putObservations: vi.fn(),
    },
  },
}))

import { CONTEXT_BANK_ANALYSIS_TOOLS } from './context-bank-analysis'

describe('get_source_transcript backfill', () => {
  beforeEach(() => {
    mocks.reads = 0
    mocks.putTranscript.mockClear()
    mocks.flush.mockClear()
  })

  it('backfills an existing canonical asset transcript when the Context Bank misses', async () => {
    const tool = CONTEXT_BANK_ANALYSIS_TOOLS.find(item => item.name === 'get_source_transcript')!
    const result = await tool.run({ asset_id: 'asset-1', purpose: 'reuse existing narration transcript' })

    expect(mocks.putTranscript).toHaveBeenCalledWith(expect.objectContaining({
      projectPath: 'D:\\Reviews\\review.lumen',
      projectId: 'project-1',
      assetId: 'asset-1',
      provider: 'lumen-project',
      model: 'asset-transcript',
      analysisVersion: 'asset-transcript-backfill-v1',
      words: [],
      segments: mocks.transcript,
    }))
    expect(result).toMatchObject({ found: true, segments: mocks.transcript })
    expect(mocks.reads).toBe(2)
  })
})

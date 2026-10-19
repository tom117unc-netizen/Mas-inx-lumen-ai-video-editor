import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  path: 'D:\\Reviews\\review.lumen' as string | null,
  projectId: 'project-1',
  order: [] as string[],
  flush: vi.fn(async () => { mocks.order.push('flush') }),
  getTranscript: vi.fn(async () => {
    mocks.order.push('getTranscript')
    return { projectId: 'project-1', assetId: 'asset-1', fingerprint: 'a'.repeat(64), found: false, words: [], segments: [], truncated: false, warnings: [] }
  }),
  getObservations: vi.fn(async () => {
    mocks.order.push('getObservations')
    return { projectId: 'project-1', assetId: 'asset-1', fingerprint: 'a'.repeat(64), observations: [], truncated: false, warnings: [] }
  }),
  putObservations: vi.fn(async (request: unknown) => {
    mocks.order.push('putObservations')
    return request
  }),
}))

vi.mock('@/editor/store', () => ({ getProject: () => ({ id: mocks.projectId }) }))
vi.mock('@/project/session', () => ({ useSession: { getState: () => ({ path: mocks.path }) } }))
vi.mock('@/project/context-bank-runtime', () => ({ flushContextBankWrites: mocks.flush }))
vi.mock('@/lib/platform', () => ({
  desktop: {
    contextBank: {
      getTranscript: mocks.getTranscript,
      getObservations: mocks.getObservations,
      putObservations: mocks.putObservations,
    },
  },
}))

import {
  CONTEXT_BANK_ANALYSIS_TOOLS,
  MAX_SOURCE_OBSERVATION_CHARACTERS,
  MAX_SOURCE_OBSERVATION_ITEMS,
  MAX_SOURCE_TRANSCRIPT_CHARACTERS,
  MAX_SOURCE_TRANSCRIPT_SEGMENTS,
  MAX_SOURCE_TRANSCRIPT_WORDS,
  makeSourceObservationQuery,
  makeSourceObservationWrite,
  makeSourceTranscriptQuery,
} from './context-bank-analysis'

describe('Context Bank analysis tool requests', () => {
  beforeEach(() => {
    mocks.path = 'D:\\Reviews\\review.lumen'
    mocks.projectId = 'project-1'
    mocks.order.length = 0
    mocks.flush.mockClear()
    mocks.getTranscript.mockClear()
    mocks.getObservations.mockClear()
    mocks.putObservations.mockClear()
  })

  it('rejects unsaved projects and reversed source-time ranges', () => {
    expect(() => makeSourceTranscriptQuery({ asset_id: 'asset-1', purpose: 'find the sentence' }, null, 'project-1')).toThrow(/save/i)
    expect(() => makeSourceTranscriptQuery({
      asset_id: 'asset-1', purpose: 'find the sentence', start_seconds: 20, end_seconds: 10,
    }, 'D:\\Reviews\\review.lumen', 'project-1')).toThrow(/after/i)
    expect(() => makeSourceObservationQuery({
      asset_id: 'asset-1', purpose: 'find the matching scene', start_seconds: 20, end_seconds: 10,
    }, 'D:\\Reviews\\review.lumen', 'project-1')).toThrow(/after/i)
  })

  it('hard-clamps transcript and observation read budgets', () => {
    const transcript = makeSourceTranscriptQuery({
      asset_id: 'asset-1', purpose: 'repair one cut', max_words: 999_999, max_segments: 999_999, max_characters: 999_999,
    }, 'D:\\Reviews\\review.lumen', 'project-1')
    expect(transcript).toMatchObject({
      assetId: 'asset-1',
      maxWords: MAX_SOURCE_TRANSCRIPT_WORDS,
      maxSegments: MAX_SOURCE_TRANSCRIPT_SEGMENTS,
      maxCharacters: MAX_SOURCE_TRANSCRIPT_CHARACTERS,
    })

    const observations = makeSourceObservationQuery({
      asset_id: 'asset-1', purpose: 'find verified scene notes', max_items: 999_999, max_characters: 999_999,
    }, 'D:\\Reviews\\review.lumen', 'project-1')
    expect(observations).toMatchObject({
      assetId: 'asset-1',
      maxItems: MAX_SOURCE_OBSERVATION_ITEMS,
      maxCharacters: MAX_SOURCE_OBSERVATION_CHARACTERS,
    })
  })

  it('builds one compact idempotent observation without exposing fingerprint, SQL, clear, or arbitrary metadata', () => {
    const args = {
      asset_id: 'episode-2',
      kind: 'scene',
      start_seconds: 12.25,
      end_seconds: 18.5,
      text: 'Mitsuki enters the room and looks toward Yuya.',
      provenance_source: 'direct inspection of the imported episode footage',
      confidence: 0.94,
    }
    const one = makeSourceObservationWrite(args, 'D:\\Reviews\\review.lumen', 'project-1', 1234)
    const two = makeSourceObservationWrite(args, 'D:\\Reviews\\review.lumen', 'project-1', 1234)
    expect(one).toEqual(two)
    expect(one.observations).toHaveLength(1)
    expect(one.observations[0]).toMatchObject({
      kind: 'scene', start: 12.25, end: 18.5,
      text: 'Mitsuki enters the room and looks toward Yuya.',
      confidence: 0.94,
      provenance: {
        producer: 'anime-review-ai',
        source: 'direct inspection of the imported episode footage',
        createdAt: 1234,
      },
      analysisVersion: 'ai-source-observation-v1',
    })
    expect(one.observations[0].id).toMatch(/^ai-source-[a-f0-9]{16}$/)
    const serialized = JSON.stringify(one)
    expect(serialized).not.toMatch(/fingerprint|sql|clear|metadata/i)
  })

  it('validates observation confidence and source range before any IPC call can occur', () => {
    const base = {
      asset_id: 'asset-1', kind: 'scene', start_seconds: 2, end_seconds: 4,
      text: 'A verified scene.', provenance_source: 'imported footage',
    }
    expect(() => makeSourceObservationWrite({ ...base, confidence: 1.2 }, 'D:\\Reviews\\review.lumen', 'project-1', 1)).toThrow(/confidence/i)
    expect(() => makeSourceObservationWrite({ ...base, start_seconds: 5, end_seconds: 5 }, 'D:\\Reviews\\review.lumen', 'project-1', 1)).toThrow(/after/i)
  })

  it('waits for pending Context Bank synchronization before every analysis read or write', async () => {
    const transcript = CONTEXT_BANK_ANALYSIS_TOOLS.find(tool => tool.name === 'get_source_transcript')!
    await transcript.run({ asset_id: 'asset-1', purpose: 'find one sentence' })
    expect(mocks.order).toEqual(['flush', 'getTranscript'])

    mocks.order.length = 0
    const observations = CONTEXT_BANK_ANALYSIS_TOOLS.find(tool => tool.name === 'get_source_observations')!
    await observations.run({ asset_id: 'asset-1', purpose: 'find a verified scene' })
    expect(mocks.order).toEqual(['flush', 'getObservations'])

    mocks.order.length = 0
    const record = CONTEXT_BANK_ANALYSIS_TOOLS.find(tool => tool.name === 'record_source_observation')!
    await record.run({
      asset_id: 'asset-1', kind: 'scene', start_seconds: 2, end_seconds: 4,
      text: 'A verified scene.', provenance_source: 'imported footage',
    })
    expect(mocks.order).toEqual(['flush', 'putObservations'])
  })
})

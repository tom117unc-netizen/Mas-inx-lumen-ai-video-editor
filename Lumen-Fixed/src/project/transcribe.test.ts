import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from '@shared/integrations'
import type { ContextBankTranscriptWriteRequest } from '@shared/context-bank-analysis'
import type { ElevenLabsScribeJobDetail } from '@shared/scribe'

const mocks = vi.hoisted(() => ({
  project: {
    id: 'project-1',
    assets: {
      'asset-1': {
        id: 'asset-1',
        name: 'Narration',
        kind: 'audio',
        source: { type: 'file', url: 'lumen-media://narration', path: 'D:\\Media\\narration.wav' },
        hasAudio: true,
      },
    },
  } as any,
  dispatch: vi.fn(),
  elevenJob: vi.fn(),
  subscribe: vi.fn(() => () => {}),
  putTranscript: vi.fn(),
  flush: vi.fn(async () => {}),
  doneJob: null as (Job & ElevenLabsScribeJobDetail) | null,
}))

vi.mock('@/editor/store', () => ({
  getProject: () => mocks.project,
  dispatch: mocks.dispatch,
}))

vi.mock('@/engine/audio-engine', () => ({ speechAudio: vi.fn() }))
vi.mock('@/engine/wav', () => ({ speechWav: vi.fn() }))
vi.mock('@/integrations/ai', () => ({
  useAi: { getState: () => ({ providers: {} }) },
}))
vi.mock('./whisper', () => ({ transcribeLocally: vi.fn() }))

vi.mock('@/integrations/store', () => ({
  api: {},
  transcribeAsset: mocks.elevenJob,
  useIntegrations: {
    getState: () => ({
      elevenlabs: { configured: true },
      jobs: mocks.doneJob ? { [mocks.doneJob.id]: mocks.doneJob } : {},
    }),
    subscribe: mocks.subscribe,
  },
}))

vi.mock('@/lib/platform', () => ({
  desktop: {
    contextBank: {
      putTranscript: mocks.putTranscript,
    },
  },
}))

vi.mock('./session', () => ({
  useSession: { getState: () => ({ path: 'D:\\Reviews\\review.lumen' }) },
}))

vi.mock('./context-bank-runtime', () => ({
  flushContextBankWrites: mocks.flush,
}))

import { transcribeMedia } from './transcribe'

describe('transcribeMedia reusable Scribe analysis', () => {
  beforeEach(() => {
    mocks.dispatch.mockReset()
    mocks.elevenJob.mockReset().mockResolvedValue({ id: 'job-1' })
    mocks.subscribe.mockReset().mockImplementation(() => () => {})
    mocks.flush.mockReset().mockResolvedValue(undefined)
    mocks.putTranscript.mockReset().mockImplementation(async (request: ContextBankTranscriptWriteRequest) => ({
      projectId: request.projectId,
      assetId: request.assetId,
      fingerprint: 'b'.repeat(64),
      found: true,
      provider: request.provider,
      model: request.model,
      language: request.language,
      analysisVersion: request.analysisVersion,
      createdAt: request.createdAt,
      words: request.words,
      segments: request.segments,
      truncated: false,
      warnings: [],
    }))
    mocks.doneJob = {
      id: 'job-1',
      integration: 'elevenlabs',
      title: 'Transcribe — Narration',
      status: 'done',
      progress: 1,
      startedAt: 100,
      finishedAt: 456,
      transcript: [
        { start: 0.1, end: 0.9, text: 'Hello there.' },
        { start: 1.8, end: 2.7, text: 'General Kenobi' },
      ],
      transcriptWords: [
        { start: 0.1, end: 0.4, text: 'Hello' },
        { start: 0.45, end: 0.9, text: 'there.' },
        { start: 1.8, end: 2.2, text: 'General' },
        { start: 2.25, end: 2.7, text: 'Kenobi' },
      ],
      transcriptMeta: {
        provider: 'elevenlabs',
        model: 'scribe_v2',
        language: 'en',
        analysisVersion: 'scribe_v2-word-v1',
      },
    }
  })

  it('returns the existing phrase transcript and persists detailed Scribe words exactly once', async () => {
    const result = await transcribeMedia('asset-1', { using: 'elevenlabs' })

    expect(result).toEqual(mocks.doneJob?.transcript)
    expect(mocks.putTranscript).toHaveBeenCalledTimes(1)
    expect(mocks.putTranscript).toHaveBeenCalledWith({
      projectPath: 'D:\\Reviews\\review.lumen',
      projectId: 'project-1',
      assetId: 'asset-1',
      provider: 'elevenlabs',
      model: 'scribe_v2',
      language: 'en',
      analysisVersion: 'scribe_v2-word-v1',
      words: mocks.doneJob?.transcriptWords,
      segments: mocks.doneJob?.transcript,
      createdAt: 456,
    })
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })
})

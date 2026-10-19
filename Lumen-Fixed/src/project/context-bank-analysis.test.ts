import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContextBankTranscriptWriteRequest } from '@shared/context-bank-analysis'

const mocks = vi.hoisted(() => ({
  path: null as string | null,
  projectId: 'project-1',
  flush: vi.fn(async () => {}),
  putTranscript: vi.fn(async (request: ContextBankTranscriptWriteRequest) => ({
    projectId: request.projectId,
    assetId: request.assetId,
    fingerprint: 'a'.repeat(64),
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
  })),
}))

vi.mock('@/lib/platform', () => ({
  desktop: {
    contextBank: {
      putTranscript: mocks.putTranscript,
    },
  },
}))

vi.mock('@/editor/store', () => ({
  getProject: () => ({ id: mocks.projectId }),
}))

vi.mock('./session', () => ({
  useSession: {
    getState: () => ({ path: mocks.path }),
  },
}))

vi.mock('./context-bank-runtime', () => ({
  flushContextBankWrites: mocks.flush,
}))

import { persistTranscriptAnalysis } from './context-bank-analysis'

const detail = {
  provider: 'elevenlabs' as const,
  model: 'scribe_v2' as const,
  language: 'en',
  analysisVersion: 'scribe_v2-word-v1' as const,
  words: [{ start: 0.1, end: 0.4, text: 'Hello' }],
  segments: [{ start: 0.1, end: 0.4, text: 'Hello' }],
  createdAt: 123,
}

describe('persistTranscriptAnalysis', () => {
  beforeEach(() => {
    mocks.path = null
    mocks.projectId = 'project-1'
    mocks.flush.mockReset().mockResolvedValue(undefined)
    mocks.putTranscript.mockReset().mockImplementation(async (request: ContextBankTranscriptWriteRequest) => ({
      projectId: request.projectId,
      assetId: request.assetId,
      fingerprint: 'a'.repeat(64),
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
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does nothing for an unsaved project', async () => {
    await persistTranscriptAnalysis('asset-1', detail)
    expect(mocks.flush).not.toHaveBeenCalled()
    expect(mocks.putTranscript).not.toHaveBeenCalled()
  })

  it('waits for queued Context Bank writes before persisting against the current project identity', async () => {
    mocks.path = 'D:\\Reviews\\review.lumen'
    const order: string[] = []
    mocks.flush.mockImplementation(async () => { order.push('flush') })
    mocks.putTranscript.mockImplementation(async (request: ContextBankTranscriptWriteRequest) => {
      order.push('put')
      return {
        projectId: request.projectId,
        assetId: request.assetId,
        fingerprint: 'a'.repeat(64),
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
      }
    })

    await persistTranscriptAnalysis('asset-1', detail)

    expect(order).toEqual(['flush', 'put'])
    expect(mocks.putTranscript).toHaveBeenCalledTimes(1)
    expect(mocks.putTranscript).toHaveBeenCalledWith({
      projectPath: 'D:\\Reviews\\review.lumen',
      projectId: 'project-1',
      assetId: 'asset-1',
      ...detail,
    })
  })

  it('logs a warning instead of failing the successful transcription when cache persistence fails', async () => {
    mocks.path = 'D:\\Reviews\\review.lumen'
    mocks.putTranscript.mockRejectedValueOnce(new Error('disk busy'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(persistTranscriptAnalysis('asset-1', detail)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })
})

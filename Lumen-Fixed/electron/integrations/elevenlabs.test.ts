import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const jobMocks = vi.hoisted(() => ({
  finishJob: vi.fn(),
  failJob: vi.fn(),
  updateJob: vi.fn(),
  setCanceller: vi.fn(),
}))

vi.mock('./jobs', () => ({
  createJob: vi.fn((integration: string, title: string) => ({
    id: 'scribe-job',
    integration,
    title,
    status: 'running',
    progress: -1,
    startedAt: 1,
  })),
  finishJob: jobMocks.finishJob,
  failJob: jobMocks.failJob,
  updateJob: jobMocks.updateJob,
  setCanceller: jobMocks.setCanceller,
}))

vi.mock('./secrets', () => ({
  getSecret: vi.fn(() => 'test-key'),
  secretHint: vi.fn(() => '••••'),
  setSecret: vi.fn(),
}))

vi.mock('./paths', () => ({
  ensureDir: vi.fn((value: string) => value),
  mediaRoot: vi.fn(() => 'D:\\LumenMedia'),
  mediaUrl: vi.fn((value: string) => `lumen-media://${value}`),
}))

import { transcribe } from './elevenlabs'

describe('ElevenLabs Scribe transcript shaping', () => {
  beforeEach(() => {
    jobMocks.finishJob.mockReset()
    jobMocks.failJob.mockReset()
    jobMocks.updateJob.mockReset()
    jobMocks.setCanceller.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps normalized word timings and metadata while preserving phrase transcript semantics', async () => {
    const response = {
      text: 'Hello there. General Kenobi',
      language_code: 'en',
      words: [
        { text: ' Hello ', start: 0.1, end: 0.4, type: 'word' },
        { text: 'there.', start: 0.45, end: 0.9, type: 'word' },
        { text: ' ', start: 0.9, end: 0.95, type: 'spacing' },
        { text: 'General', start: 1.8, end: 2.2, type: 'word' },
        { text: 'Kenobi', start: 2.25, end: 2.7, type: 'word' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })))

    transcribe({ wav: new ArrayBuffer(16), name: 'Narration' })

    await vi.waitFor(() => expect(jobMocks.finishJob).toHaveBeenCalledTimes(1))
    const [, patch] = jobMocks.finishJob.mock.calls[0]
    expect(patch).toMatchObject({
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
      message: '2 phrases · en',
    })
    expect(jobMocks.failJob).not.toHaveBeenCalled()
  })
})

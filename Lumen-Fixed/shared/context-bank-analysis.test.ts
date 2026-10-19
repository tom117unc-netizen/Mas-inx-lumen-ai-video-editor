import { describe, expect, it } from 'vitest'
import {
  CONTEXT_BANK_ANALYSIS_VERSION_MAX,
  CONTEXT_BANK_OBSERVATION_TEXT_MAX,
  CONTEXT_BANK_PROVENANCE_STRING_MAX,
  CONTEXT_BANK_TRANSCRIPT_TEXT_MAX,
  validateAnalysisVersion,
  validateObservationInput,
  validateSourceRange,
  validateTranscriptItems,
  type ContextBankObservationInput,
} from './context-bank-analysis'

describe('Context Bank reusable analysis contracts', () => {
  it('accepts monotonic finite transcript timing', () => {
    expect(() => validateTranscriptItems([
      { start: 0, end: 0.2, text: 'One' },
      { start: 0.2, end: 0.55, text: 'two' },
      { start: 0.5, end: 0.9, text: 'three' },
    ])).not.toThrow()
    expect(() => validateTranscriptItems([
      { start: 0.5, end: 0.8, text: 'later' },
      { start: 0.4, end: 0.9, text: 'backwards' },
    ])).toThrow(/monotonic/i)
    expect(() => validateTranscriptItems([{ start: 0, end: Number.POSITIVE_INFINITY, text: 'bad' }])).toThrow(/finite/i)
    expect(() => validateTranscriptItems([{ start: 0, end: 1, text: 'x'.repeat(CONTEXT_BANK_TRANSCRIPT_TEXT_MAX + 1) }])).toThrow(/text/i)
    expect(() => validateAnalysisVersion('scribe_v2-word-v1')).not.toThrow()
    expect(() => validateAnalysisVersion('')).toThrow(/version/i)
    expect(() => validateAnalysisVersion('x'.repeat(CONTEXT_BANK_ANALYSIS_VERSION_MAX + 1))).toThrow(/version/i)
  })

  it('rejects negative or reversed source ranges', () => {
    expect(() => validateSourceRange(undefined, undefined)).not.toThrow()
    expect(() => validateSourceRange(0, 1)).not.toThrow()
    expect(() => validateSourceRange(-0.01, 1)).toThrow(/non-negative/i)
    expect(() => validateSourceRange(2, 2)).toThrow(/after/i)
    expect(() => validateSourceRange(3, 2)).toThrow(/after/i)
    expect(() => validateSourceRange(Number.NaN, 2)).toThrow(/finite/i)
  })

  it('rejects nested or unbounded observation provenance', () => {
    const valid: ContextBankObservationInput = {
      id: 'obs_1',
      kind: 'scene',
      start: 1.25,
      end: 2.5,
      text: 'Character enters the room.',
      confidence: 0.9,
      analysisVersion: 'vision-v1',
      provenance: {
        producer: 'lumen-vision',
        model: 'example-model',
        source: 'verified-media',
        createdAt: 123,
        metadata: { episode: '02', sampled: true, frame: 3400 },
      },
    }
    expect(() => validateObservationInput(valid)).not.toThrow()
    expect(() => validateObservationInput({ ...valid, confidence: 1.01 })).toThrow(/confidence/i)
    expect(() => validateObservationInput({ ...valid, text: 'x'.repeat(CONTEXT_BANK_OBSERVATION_TEXT_MAX + 1) })).toThrow(/text/i)
    expect(() => validateObservationInput({
      ...valid,
      provenance: { ...valid.provenance, producer: 'x'.repeat(CONTEXT_BANK_PROVENANCE_STRING_MAX + 1) },
    })).toThrow(/provenance/i)
    expect(() => validateObservationInput({
      ...valid,
      provenance: { ...valid.provenance, metadata: { nested: { not: 'allowed' } } as never },
    })).toThrow(/primitive/i)
  })
})

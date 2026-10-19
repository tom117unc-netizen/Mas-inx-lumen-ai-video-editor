import { describe, expect, it } from 'vitest'
import {
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
})

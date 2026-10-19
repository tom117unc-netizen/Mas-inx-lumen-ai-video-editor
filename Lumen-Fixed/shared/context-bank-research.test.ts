import { describe, expect, it } from 'vitest'
import {
  CONTEXT_BANK_RESEARCH_CHUNK_TEXT_MAX,
  CONTEXT_BANK_RESEARCH_EVIDENCE_EXCERPT_MAX,
  CONTEXT_BANK_RESEARCH_SEARCH_ITEMS_MAX,
  type ContextBankResearchPrior,
  type ContextBankResearchSearchRequest,
  validatePublicResearchUrl,
  validateResearchChunk,
  validateResearchPrior,
  validateResearchSearchRequest,
} from './context-bank-research'

const prior = (): ContextBankResearchPrior => ({
  id: 'prior:episode-2-staircase',
  query: 'Hiyori staircase reveal',
  text: 'The staircase reveal is described as occurring in episode 2, early in the episode.',
  episodeNumber: 2,
  positionHint: 'early',
  confidence: 0.78,
  evidence: {
    sourceId: 'source:guide',
    chunkId: 'chunk:guide:2',
    excerpt: 'Episode 2 opens with the staircase sequence.',
  },
  provenance: {
    producer: 'lumen-ai',
    analysisVersion: 'research-prior-v1',
    createdAt: 1_700_000_000_000,
  },
})

describe('Context Bank research contracts', () => {
  it('accepts a bounded source-backed research prior with only coarse source-location hints', () => {
    expect(() => validateResearchPrior(prior())).not.toThrow()
  })

  it('rejects verified-media style timestamps and provenance on research priors', () => {
    const withTimestamp = { ...prior(), startSeconds: 12.3 } as unknown as ContextBankResearchPrior
    expect(() => validateResearchPrior(withTimestamp)).toThrow(/unsupported field/i)

    const verifiedMedia = {
      ...prior(),
      provenance: { ...prior().provenance, producer: 'verified-media' },
    }
    expect(() => validateResearchPrior(verifiedMedia)).toThrow(/verified-media/i)
  })

  it('requires confidence, episode numbers, position hints and evidence excerpts to stay bounded', () => {
    expect(() => validateResearchPrior({ ...prior(), confidence: 1.01 })).toThrow(/confidence/i)
    expect(() => validateResearchPrior({ ...prior(), episodeNumber: 0 })).toThrow(/episode/i)
    expect(() => validateResearchPrior({ ...prior(), positionHint: 'somewhere' as 'early' })).toThrow(/position/i)
    expect(() => validateResearchPrior({
      ...prior(),
      evidence: { ...prior().evidence, excerpt: 'x'.repeat(CONTEXT_BANK_RESEARCH_EVIDENCE_EXCERPT_MAX + 1) },
    })).toThrow(/excerpt/i)
  })

  it('bounds research chunks and search requests deterministically', () => {
    expect(() => validateResearchChunk({
      id: 'chunk:1',
      sourceId: 'source:1',
      ordinal: 0,
      heading: 'Episode 2',
      text: 'x'.repeat(CONTEXT_BANK_RESEARCH_CHUNK_TEXT_MAX + 1),
      episodeNumber: 2,
    })).toThrow(/chunk text/i)

    const request: ContextBankResearchSearchRequest = {
      projectPath: 'D:\\Reviews\\show.lumen',
      projectId: 'proj_1',
      query: 'staircase reveal',
      maxItems: CONTEXT_BANK_RESEARCH_SEARCH_ITEMS_MAX,
      maxCharacters: 8_000,
    }
    expect(() => validateResearchSearchRequest(request)).not.toThrow()
    expect(() => validateResearchSearchRequest({ ...request, maxItems: CONTEXT_BANK_RESEARCH_SEARCH_ITEMS_MAX + 1 })).toThrow(/maxItems/i)
    expect(() => validateResearchSearchRequest({ ...request, maxCharacters: 0 })).toThrow(/maxCharacters/i)
  })

  it('accepts public http(s) research URLs and rejects local or non-web URLs', () => {
    expect(validatePublicResearchUrl('https://example.com/episode-guide')).toBe('https://example.com/episode-guide')
    expect(validatePublicResearchUrl('http://example.org/wiki')).toBe('http://example.org/wiki')
    expect(() => validatePublicResearchUrl('file:///D:/notes.txt')).toThrow(/http/i)
    expect(() => validatePublicResearchUrl('http://127.0.0.1:3000/private')).toThrow(/public/i)
    expect(() => validatePublicResearchUrl('http://192.168.1.20/page')).toThrow(/public/i)
    expect(() => validatePublicResearchUrl('http://localhost/page')).toThrow(/public/i)
  })
})

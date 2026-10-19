import type { ContextBankTranscriptWord } from './context-bank-analysis'

export const ELEVENLABS_SCRIBE_MODEL = 'scribe_v2' as const
export const ELEVENLABS_SCRIBE_ANALYSIS_VERSION = 'scribe_v2-word-v1' as const

export interface ElevenLabsScribeTranscriptMeta {
  provider: 'elevenlabs'
  model: typeof ELEVENLABS_SCRIBE_MODEL
  language?: string
  analysisVersion: typeof ELEVENLABS_SCRIBE_ANALYSIS_VERSION
}

/** Supplementary detail carried by an ElevenLabs transcription job. */
export interface ElevenLabsScribeJobDetail {
  transcriptWords: ContextBankTranscriptWord[]
  transcriptMeta: ElevenLabsScribeTranscriptMeta
}

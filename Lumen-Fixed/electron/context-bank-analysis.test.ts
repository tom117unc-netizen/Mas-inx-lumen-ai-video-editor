import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import type { ContextBankTranscriptQuery, ContextBankTranscriptWriteRequest } from '../shared/context-bank-analysis'
import { CONTEXT_BANK_MIRROR_FORMAT, CONTEXT_BANK_MIRROR_VERSION, type ContextBankMirror } from '../shared/context-bank'
import { contextBankPath, openContextBank } from './context-bank'
import { DatabaseSync } from 'node:sqlite'

const roots: string[] = []

function projectFile(name = 'review.lumen') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-context-analysis-'))
  roots.push(root)
  return path.join(root, name)
}

function sourceMirror(projectId: string, source: string, revision = 1): ContextBankMirror {
  const stat = fs.statSync(source)
  return {
    format: CONTEXT_BANK_MIRROR_FORMAT,
    version: CONTEXT_BANK_MIRROR_VERSION,
    projectId,
    projectName: 'Analysis test',
    revision,
    assets: [{
      id: 'asset-1', name: 'Narration', kind: 'audio', duration: 20, hasAudio: true,
      path: source, fileName: path.basename(source), mime: 'audio/wav', size: stat.size,
      mtime: Math.round(stat.mtimeMs), missing: false,
    }],
    sequences: [{ id: 'main', name: 'Main', fps: 30, clips: [], markers: [] }],
  }
}

function request(projectPath: string, projectId: string, createdAt = 100): ContextBankTranscriptWriteRequest {
  return {
    projectPath,
    projectId,
    assetId: 'asset-1',
    provider: 'elevenlabs',
    model: 'scribe_v2',
    language: 'en',
    analysisVersion: 'scribe_v2-word-v1',
    words: [
      { start: 0.1, end: 0.3, text: 'This' },
      { start: 0.31, end: 0.6, text: 'works' },
    ],
    segments: [{ start: 0.1, end: 0.6, text: 'This works' }],
    createdAt,
  }
}

function query(projectPath: string, projectId: string): ContextBankTranscriptQuery {
  return { projectPath, projectId, assetId: 'asset-1', maxWords: 100, maxSegments: 100, maxCharacters: 20_000 }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Context Bank source transcripts', () => {
  it('persists an exact gzip transcript payload across close and reopen', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'narration.wav')
    fs.writeFileSync(source, Buffer.from('fake-wave-data-for-fingerprint'))

    const first = openContextBank(projectPath, 'project-1')
    try {
      first.sync({ projectPath, mirror: sourceMirror('project-1', source) })
      const written = first.putTranscript(request(projectPath, 'project-1'))
      expect(written).toMatchObject({ found: true, projectId: 'project-1', assetId: 'asset-1', provider: 'elevenlabs', model: 'scribe_v2' })
      expect(written.words).toEqual(request(projectPath, 'project-1').words)
    } finally {
      first.close()
    }

    const db = new DatabaseSync(contextBankPath(projectPath, 'project-1'), { readOnly: true })
    try {
      const row = db.prepare('SELECT payload FROM source_transcripts LIMIT 1').get() as { payload: Uint8Array }
      const decoded = JSON.parse(gunzipSync(Buffer.from(row.payload)).toString('utf8')) as { words: unknown; segments: unknown }
      expect(decoded.words).toEqual(request(projectPath, 'project-1').words)
      expect(decoded.segments).toEqual(request(projectPath, 'project-1').segments)
    } finally {
      db.close()
    }

    const reopened = openContextBank(projectPath, 'project-1')
    try {
      expect(reopened.getTranscript(query(projectPath, 'project-1'))).toMatchObject({
        found: true,
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        provider: 'elevenlabs',
        model: 'scribe_v2',
        language: 'en',
        analysisVersion: 'scribe_v2-word-v1',
        createdAt: 100,
        words: request(projectPath, 'project-1').words,
        segments: request(projectPath, 'project-1').segments,
      })
    } finally {
      reopened.close()
    }
  })

  it('keeps transcript storage isolated between project ids', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'narration.wav')
    fs.writeFileSync(source, Buffer.from('same-source'))
    const one = openContextBank(projectPath, 'project-1')
    const two = openContextBank(projectPath, 'project-2')
    try {
      one.sync({ projectPath, mirror: sourceMirror('project-1', source) })
      two.sync({ projectPath, mirror: sourceMirror('project-2', source) })
      one.putTranscript(request(projectPath, 'project-1'))
      expect(one.getTranscript(query(projectPath, 'project-1')).found).toBe(true)
      expect(two.getTranscript(query(projectPath, 'project-2')).found).toBe(false)
    } finally {
      two.close()
      one.close()
    }
  })

  it('rejects transcript writes when the current asset has no resolved fingerprint', () => {
    const projectPath = projectFile()
    const missing = path.join(path.dirname(projectPath), 'missing.wav')
    const mirror = sourceMirror('project-1', (() => {
      const temporary = path.join(path.dirname(projectPath), 'temporary.wav')
      fs.writeFileSync(temporary, Buffer.from('temporary'))
      return temporary
    })())
    mirror.assets[0].path = missing
    mirror.assets[0].fileName = 'missing.wav'
    mirror.assets[0].missing = true
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.sync({ projectPath, mirror })
      expect(() => store.putTranscript(request(projectPath, 'project-1'))).toThrow(/fingerprint|source/i)
    } finally {
      store.close()
    }
  })

  it('returns only transcript items overlapping the requested source-time range', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'long-narration.wav')
    fs.writeFileSync(source, Buffer.from('long-source'))
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.sync({ projectPath, mirror: sourceMirror('project-1', source) })
      const words = Array.from({ length: 10_000 }, (_, i) => ({ start: i / 10, end: i / 10 + 0.05, text: `w${i}` }))
      const segments = Array.from({ length: 1_000 }, (_, i) => ({ start: i, end: i + 0.95, text: `segment-${i}` }))
      store.putTranscript({ ...request(projectPath, 'project-1'), words, segments })
      const result = store.getTranscript({
        ...query(projectPath, 'project-1'),
        startSeconds: 120,
        endSeconds: 125,
        maxWords: 1_000,
        maxSegments: 1_000,
        maxCharacters: 100_000,
      })
      expect(result.words).toHaveLength(50)
      expect(result.words[0]?.text).toBe('w1200')
      expect(result.words.at(-1)?.text).toBe('w1249')
      expect(result.segments.map(item => item.text)).toEqual(['segment-120', 'segment-121', 'segment-122', 'segment-123', 'segment-124'])
      expect(result.truncated).toBe(false)
    } finally {
      store.close()
    }
  })

  it('enforces item and character budgets deterministically', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'budget.wav')
    fs.writeFileSync(source, Buffer.from('budget-source'))
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.sync({ projectPath, mirror: sourceMirror('project-1', source) })
      const words = Array.from({ length: 20 }, (_, i) => ({ start: i, end: i + 0.4, text: `word-${i}-${'x'.repeat(50)}` }))
      const segments = Array.from({ length: 5 }, (_, i) => ({ start: i * 4, end: i * 4 + 3.5, text: `segment-${i}-${'y'.repeat(80)}` }))
      store.putTranscript({ ...request(projectPath, 'project-1'), words, segments })

      const itemLimited = store.getTranscript({ ...query(projectPath, 'project-1'), maxWords: 3, maxSegments: 2 })
      expect(itemLimited.words).toHaveLength(3)
      expect(itemLimited.segments).toHaveLength(2)
      expect(itemLimited.truncated).toBe(true)

      const charLimited = store.getTranscript({ ...query(projectPath, 'project-1'), maxWords: 100, maxSegments: 100, maxCharacters: 800 })
      expect(charLimited.truncated).toBe(true)
      expect(charLimited.provider).toBe('elevenlabs')
      expect(charLimited.warnings.length).toBeGreaterThan(0)
      expect(JSON.stringify(charLimited).length).toBeLessThanOrEqual(800)
    } finally {
      store.close()
    }
  })

  it('keeps analysis through timeline-only moves but stops reusing it after source replacement', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'episode.wav')
    fs.writeFileSync(source, Buffer.from('original-source'))
    const firstMirror = sourceMirror('project-1', source, 1)
    firstMirror.sequences[0].clips.push({
      sequenceId: 'main', clipId: 'clip-1', trackId: 'audio-1', name: 'Narration', kind: 'audio',
      start: 30, duration: 90, assetId: 'asset-1', inPoint: 0, speed: 1,
      reverse: false, freeze: false, hasSpeedRamp: false,
    })
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.sync({ projectPath, mirror: firstMirror })
      store.putTranscript(request(projectPath, 'project-1'))
      const before = store.getTranscript(query(projectPath, 'project-1'))
      expect(before.found).toBe(true)

      const moved = structuredClone(firstMirror)
      moved.revision = 2
      moved.sequences[0].clips[0].start = 300
      store.sync({ projectPath, mirror: moved })
      expect(store.getTranscript(query(projectPath, 'project-1')).fingerprint).toBe(before.fingerprint)
      expect(store.getTranscript(query(projectPath, 'project-1')).found).toBe(true)

      fs.writeFileSync(source, Buffer.from('replacement-source-with-different-size'))
      const replaced = sourceMirror('project-1', source, 3)
      replaced.sequences[0].clips = moved.sequences[0].clips
      store.sync({ projectPath, mirror: replaced })
      const after = store.getTranscript(query(projectPath, 'project-1'))
      expect(after.found).toBe(false)
      expect(after.fingerprint).not.toBe(before.fingerprint)
    } finally {
      store.close()
    }
  })

  it('uses transcript id as a stable tie-break when timestamps match', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'tie.wav')
    fs.writeFileSync(source, Buffer.from('tie-source'))
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.sync({ projectPath, mirror: sourceMirror('project-1', source) })
    } finally {
      store.close()
    }

    const db = new DatabaseSync(contextBankPath(projectPath, 'project-1'))
    try {
      const fingerprint = String((db.prepare('SELECT fingerprint FROM source_assets WHERE asset_id = ?').get('asset-1') as { fingerprint: string }).fingerprint)
      const insert = db.prepare(`
        INSERT INTO source_transcripts(transcript_id,fingerprint,asset_id,provider,model,language,analysis_version,created_at,payload)
        VALUES (?,?,?,?,?,?,?,?,?)
      `)
      insert.run('aaa', fingerprint, 'asset-1', 'elevenlabs', 'scribe_v2', 'en', 'scribe_v2-word-v1', 500,
        gzipSync(Buffer.from(JSON.stringify({ words: [{ start: 0, end: 1, text: 'older-id' }], segments: [] }))))
      insert.run('zzz', fingerprint, 'asset-1', 'elevenlabs', 'scribe_v2', 'en', 'scribe_v2-word-v1', 500,
        gzipSync(Buffer.from(JSON.stringify({ words: [{ start: 0, end: 1, text: 'stable-winner' }], segments: [] }))))
    } finally {
      db.close()
    }

    const reopened = openContextBank(projectPath, 'project-1')
    try {
      expect(reopened.getTranscript(query(projectPath, 'project-1')).words[0]?.text).toBe('stable-winner')
    } finally {
      reopened.close()
    }
  })
})

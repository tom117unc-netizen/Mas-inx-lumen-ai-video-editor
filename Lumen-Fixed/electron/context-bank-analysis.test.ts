import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
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
    first.sync({ projectPath, mirror: sourceMirror('project-1', source) })
    const written = first.putTranscript(request(projectPath, 'project-1'))
    expect(written).toMatchObject({ found: true, projectId: 'project-1', assetId: 'asset-1', provider: 'elevenlabs', model: 'scribe_v2' })
    expect(written.words).toEqual(request(projectPath, 'project-1').words)
    first.close()

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
})

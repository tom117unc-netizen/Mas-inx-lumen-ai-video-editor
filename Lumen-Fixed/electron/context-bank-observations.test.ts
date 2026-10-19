import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ContextBankObservationInput, ContextBankObservationQuery } from '../shared/context-bank-analysis'
import { CONTEXT_BANK_MIRROR_FORMAT, CONTEXT_BANK_MIRROR_VERSION, type ContextBankMirror } from '../shared/context-bank'
import { openContextBank } from './context-bank'

const roots: string[] = []

function projectFile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-context-observations-'))
  roots.push(root)
  return path.join(root, 'review.lumen')
}

function sourceMirror(projectId: string, source: string, revision = 1): ContextBankMirror {
  const stat = fs.statSync(source)
  return {
    format: CONTEXT_BANK_MIRROR_FORMAT,
    version: CONTEXT_BANK_MIRROR_VERSION,
    projectId,
    projectName: 'Observation test',
    revision,
    assets: [{
      id: 'asset-1', name: 'Episode 01', kind: 'video', duration: 1200, width: 1920, height: 1080,
      fps: 24, hasAudio: true, path: source, fileName: path.basename(source), mime: 'video/x-matroska',
      size: stat.size, mtime: Math.round(stat.mtimeMs), missing: false,
    }],
    sequences: [{ id: 'main', name: 'Main', fps: 30, clips: [], markers: [] }],
  }
}

function observation(id: string, start: number, end: number, kind = 'scene', text = id): ContextBankObservationInput {
  return {
    id,
    kind,
    start,
    end,
    text,
    confidence: 0.9,
    provenance: {
      producer: 'lumen-media-analyzer',
      model: 'vision-test',
      source: 'verified-media',
      createdAt: 100,
      metadata: { episode: 1, verified: true, note: 'test' },
    },
    analysisVersion: 'vision-v1',
  }
}

function query(projectPath: string, overrides: Partial<ContextBankObservationQuery> = {}): ContextBankObservationQuery {
  return {
    projectPath,
    projectId: 'project-1',
    assetId: 'asset-1',
    maxItems: 100,
    maxCharacters: 20_000,
    ...overrides,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Context Bank source observations', () => {
  it('persists observations, filters by overlapping source range and kind, and returns deterministic order after reopen', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'episode01.mkv')
    fs.writeFileSync(source, Buffer.from('episode-source'))

    const first = openContextBank(projectPath, 'project-1')
    try {
      first.sync({ projectPath, mirror: sourceMirror('project-1', source) })
      first.putObservations({
        projectPath,
        projectId: 'project-1',
        assetId: 'asset-1',
        observations: [
          observation('z-late', 18, 22, 'scene'),
          observation('b-scene', 12, 16, 'scene'),
          observation('a-scene', 12, 15, 'scene'),
          observation('dialogue', 13, 14, 'dialogue'),
          observation('before', 1, 4, 'scene'),
        ],
      })
    } finally {
      first.close()
    }

    const reopened = openContextBank(projectPath, 'project-1')
    try {
      const result = reopened.getObservations(query(projectPath, { startSeconds: 10, endSeconds: 20, kind: 'scene' }))
      expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(result.observations.map(item => item.id)).toEqual(['a-scene', 'b-scene', 'z-late'])
      expect(result.observations[0]?.provenance).toEqual({
        producer: 'lumen-media-analyzer',
        model: 'vision-test',
        source: 'verified-media',
        createdAt: 100,
        metadata: { episode: 1, verified: true, note: 'test' },
      })
      expect(result.truncated).toBe(false)
    } finally {
      reopened.close()
    }
  })

  it('upserts repeated observation ids idempotently for the current source fingerprint', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'episode01.mkv')
    fs.writeFileSync(source, Buffer.from('episode-source'))
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.sync({ projectPath, mirror: sourceMirror('project-1', source) })
      store.putObservations({ projectPath, projectId: 'project-1', assetId: 'asset-1', observations: [observation('same-id', 5, 8, 'scene', 'first')] })
      store.putObservations({ projectPath, projectId: 'project-1', assetId: 'asset-1', observations: [observation('same-id', 6, 9, 'scene', 'updated')] })
      const result = store.getObservations(query(projectPath))
      expect(result.observations).toHaveLength(1)
      expect(result.observations[0]).toMatchObject({ id: 'same-id', start: 6, end: 9, text: 'updated' })
    } finally {
      store.close()
    }
  })

  it('rejects invalid confidence and unbounded provenance before writing', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'episode01.mkv')
    fs.writeFileSync(source, Buffer.from('episode-source'))
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.sync({ projectPath, mirror: sourceMirror('project-1', source) })
      const invalid = observation('bad-confidence', 1, 2)
      invalid.confidence = 1.5
      expect(() => store.putObservations({ projectPath, projectId: 'project-1', assetId: 'asset-1', observations: [invalid] })).toThrow(/confidence/i)

      const nested = observation('bad-meta', 2, 3)
      ;(nested.provenance as unknown as { metadata: unknown }).metadata = { nested: { not: 'primitive' } }
      expect(() => store.putObservations({
        projectPath,
        projectId: 'project-1',
        assetId: 'asset-1',
        observations: [nested as unknown as ContextBankObservationInput],
      })).toThrow(/metadata|primitive/i)
      expect(store.getObservations(query(projectPath)).observations).toEqual([])
    } finally {
      store.close()
    }
  })

  it('enforces item and character budgets without dropping provenance from retained observations', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'episode01.mkv')
    fs.writeFileSync(source, Buffer.from('episode-source'))
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.sync({ projectPath, mirror: sourceMirror('project-1', source) })
      const observations = Array.from({ length: 12 }, (_, index) => observation(
        `obs-${String(index).padStart(2, '0')}`,
        index,
        index + 0.8,
        'scene',
        `scene-${index}-${'x'.repeat(120)}`,
      ))
      store.putObservations({ projectPath, projectId: 'project-1', assetId: 'asset-1', observations })

      const itemLimited = store.getObservations(query(projectPath, { maxItems: 3 }))
      expect(itemLimited.observations.map(item => item.id)).toEqual(['obs-00', 'obs-01', 'obs-02'])
      expect(itemLimited.truncated).toBe(true)

      const charLimited = store.getObservations(query(projectPath, { maxItems: 100, maxCharacters: 900 }))
      expect(charLimited.truncated).toBe(true)
      expect(charLimited.warnings.length).toBeGreaterThan(0)
      expect(charLimited.observations.length).toBeGreaterThan(0)
      expect(charLimited.observations[0]?.provenance.producer).toBe('lumen-media-analyzer')
      expect(JSON.stringify(charLimited).length).toBeLessThanOrEqual(900)
    } finally {
      store.close()
    }
  })

  it('does not reuse observations after the underlying source fingerprint changes', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'episode01.mkv')
    fs.writeFileSync(source, Buffer.from('original-source'))
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.sync({ projectPath, mirror: sourceMirror('project-1', source, 1) })
      store.putObservations({ projectPath, projectId: 'project-1', assetId: 'asset-1', observations: [observation('verified-scene', 30, 35)] })
      const before = store.getObservations(query(projectPath))
      expect(before.observations).toHaveLength(1)

      fs.writeFileSync(source, Buffer.from('replacement-source-with-a-different-size'))
      store.sync({ projectPath, mirror: sourceMirror('project-1', source, 2) })
      const after = store.getObservations(query(projectPath))
      expect(after.fingerprint).not.toBe(before.fingerprint)
      expect(after.observations).toEqual([])
    } finally {
      store.close()
    }
  })
})

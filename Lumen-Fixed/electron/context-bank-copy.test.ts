import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTEXT_BANK_MIRROR_FORMAT, CONTEXT_BANK_MIRROR_VERSION, type ContextBankMirror } from '../shared/context-bank'
import { contextBankPath, copyContextBankForSaveAs, openContextBank } from './context-bank'

const roots: string[] = []

function root() {
  const value = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-context-copy-'))
  roots.push(value)
  return value
}

function mirror(projectId: string, revision: number, source?: string): ContextBankMirror {
  const assets: ContextBankMirror['assets'] = []
  if (source) {
    const stat = fs.statSync(source)
    assets.push({
      id: 'asset-1', name: 'Narration', kind: 'audio', duration: 10, hasAudio: true,
      path: source, fileName: path.basename(source), mime: 'audio/wav', size: stat.size,
      mtime: Math.round(stat.mtimeMs), missing: false,
    })
  }
  return {
    format: CONTEXT_BANK_MIRROR_FORMAT,
    version: CONTEXT_BANK_MIRROR_VERSION,
    projectId,
    projectName: 'Copy test',
    revision,
    assets,
    sequences: [{ id: 'main', name: 'Main', fps: 30, clips: [], markers: [] }],
  }
}

afterEach(() => {
  for (const item of roots.splice(0)) fs.rmSync(item, { recursive: true, force: true })
})

describe('Context Bank Save As copy', () => {
  it('copies a consistent database without carrying WAL/SHM sidecars to the new project', () => {
    const base = root()
    const sourceProject = path.join(base, 'old', 'review.lumen')
    const targetProject = path.join(base, 'new', 'review-copy.lumen')
    fs.mkdirSync(path.dirname(sourceProject), { recursive: true })
    const source = openContextBank(sourceProject, 'project-1')
    try {
      source.sync({
        projectPath: sourceProject,
        mirror: mirror('project-1', 5),
        mutation: { kind: 'dispatch', revision: 5, historyId: 10, label: 'Existing edit', source: 'ai', at: 50 },
      })
      copyContextBankForSaveAs('project-1', sourceProject, targetProject)
      const copied = contextBankPath(targetProject, 'project-1')
      expect(fs.existsSync(copied)).toBe(true)
      expect(fs.existsSync(`${copied}-wal`)).toBe(false)
      expect(fs.existsSync(`${copied}-shm`)).toBe(false)

      const target = openContextBank(targetProject, 'project-1')
      try {
        expect(target.status()).toMatchObject({ projectId: 'project-1', revision: 5, editEventCount: 1 })
        expect(source.status()).toMatchObject({ projectId: 'project-1', revision: 5, editEventCount: 1 })
      } finally {
        target.close()
      }
    } finally {
      source.close()
    }
  })

  it('keeps reusable source transcripts in the copied bank', () => {
    const base = root()
    const sourceProject = path.join(base, 'old', 'review.lumen')
    const targetProject = path.join(base, 'new', 'review-copy.lumen')
    fs.mkdirSync(path.dirname(sourceProject), { recursive: true })
    const media = path.join(path.dirname(sourceProject), 'narration.wav')
    fs.writeFileSync(media, Buffer.from('narration-source'))
    const source = openContextBank(sourceProject, 'project-1')
    try {
      source.sync({ projectPath: sourceProject, mirror: mirror('project-1', 5, media) })
      source.putTranscript({
        projectPath: sourceProject,
        projectId: 'project-1',
        assetId: 'asset-1',
        provider: 'elevenlabs',
        model: 'scribe_v2',
        language: 'en',
        analysisVersion: 'scribe_v2-word-v1',
        words: [{ start: 0, end: 0.4, text: 'Remembered' }],
        segments: [{ start: 0, end: 0.4, text: 'Remembered' }],
        createdAt: 100,
      })
      copyContextBankForSaveAs('project-1', sourceProject, targetProject)
      const target = openContextBank(targetProject, 'project-1')
      try {
        const result = target.getTranscript({
          projectPath: targetProject,
          projectId: 'project-1',
          assetId: 'asset-1',
          maxWords: 20,
          maxSegments: 20,
          maxCharacters: 10_000,
        })
        expect(result).toMatchObject({ found: true, words: [{ start: 0, end: 0.4, text: 'Remembered' }] })
      } finally {
        target.close()
      }
    } finally {
      source.close()
    }
  })

  it('keeps verified source observations in the copied bank', () => {
    const base = root()
    const sourceProject = path.join(base, 'old', 'review.lumen')
    const targetProject = path.join(base, 'new', 'review-copy.lumen')
    fs.mkdirSync(path.dirname(sourceProject), { recursive: true })
    const media = path.join(path.dirname(sourceProject), 'episode01.mkv')
    fs.writeFileSync(media, Buffer.from('episode-source'))
    const source = openContextBank(sourceProject, 'project-1')
    try {
      source.sync({ projectPath: sourceProject, mirror: mirror('project-1', 5, media) })
      source.putObservations({
        projectPath: sourceProject,
        projectId: 'project-1',
        assetId: 'asset-1',
        observations: [{
          id: 'scene-1',
          kind: 'scene',
          start: 12,
          end: 18,
          text: 'Character enters the room.',
          confidence: 0.95,
          provenance: { producer: 'media-analyzer', model: 'vision-v1', source: 'verified-media', createdAt: 200 },
          analysisVersion: 'scene-v1',
        }],
      })
      copyContextBankForSaveAs('project-1', sourceProject, targetProject)
      const target = openContextBank(targetProject, 'project-1')
      try {
        const result = target.getObservations({
          projectPath: targetProject,
          projectId: 'project-1',
          assetId: 'asset-1',
          maxItems: 20,
          maxCharacters: 10_000,
        })
        expect(result.observations).toEqual([expect.objectContaining({ id: 'scene-1', start: 12, end: 18 })])
      } finally {
        target.close()
      }
    } finally {
      source.close()
    }
  })
})

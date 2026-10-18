import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CONTEXT_BANK_MIRROR_FORMAT, CONTEXT_BANK_MIRROR_VERSION, type ContextBankMirror } from '../shared/context-bank'
import { contextBankPath, openContextBank } from './context-bank'

const roots: string[] = []

function projectFile(name = 'review.lumen') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-context-bank-'))
  roots.push(root)
  return path.join(root, name)
}

function mirror(projectId: string, revision = 7): ContextBankMirror {
  return {
    format: CONTEXT_BANK_MIRROR_FORMAT,
    version: CONTEXT_BANK_MIRROR_VERSION,
    projectId,
    projectName: 'Review',
    revision,
    assets: [
      {
        id: 'asset-1', name: 'Episode 01', kind: 'video', duration: 1200,
        width: 1920, height: 1080, fps: 24, hasAudio: true,
        path: 'D:\\Shows\\Episode01.mkv', fileName: 'Episode01.mkv', mime: 'video/x-matroska',
        size: 123456789, mtime: 1234, missing: false,
      },
    ],
    sequences: [
      {
        id: 'main', name: 'Main', fps: 30,
        clips: [
          {
            sequenceId: 'main', clipId: 'clip-1', trackId: 'video-1', name: 'Opening scene', kind: 'video',
            start: 90, duration: 120, assetId: 'asset-1', inPoint: 300, speed: 1,
            reverse: false, freeze: false, hasSpeedRamp: false,
          },
        ],
        markers: [{ sequenceId: 'main', markerId: 'marker-1', frame: 90, label: 'Chapter 1', color: 'lime' }],
      },
    ],
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('context bank storage', () => {
  it('keeps the database beside the .lumen project instead of app data', () => {
    const projectPath = projectFile()
    expect(contextBankPath(projectPath, 'project-1')).toBe(
      path.join(path.dirname(projectPath), '.lumen-context', 'project-1', 'context.sqlite'),
    )
    expect(() => contextBankPath('', 'project-1')).toThrow(/project path/i)
    expect(() => contextBankPath('relative/review.lumen', 'project-1')).toThrow(/absolute/i)
    expect(() => contextBankPath(projectPath, '../escape')).toThrow(/project id/i)
  })

  it('opens idempotently with schema version 1', () => {
    const projectPath = projectFile()
    const first = openContextBank(projectPath, 'project-1')
    const second = openContextBank(projectPath, 'project-1')
    try {
      expect(first.status()).toMatchObject({ available: true, schemaVersion: 1, projectId: 'project-1', revision: 0 })
      expect(second.status()).toMatchObject({ available: true, schemaVersion: 1, projectId: 'project-1', revision: 0 })
    } finally {
      second.close()
      first.close()
    }
  })

  it('persists synchronized mirror data across close and reopen', () => {
    const projectPath = projectFile()
    const first = openContextBank(projectPath, 'project-1')
    first.sync({
      projectPath,
      mirror: mirror('project-1'),
      mutation: { kind: 'dispatch', revision: 7, historyId: 42, label: 'Place scene', source: 'ai', at: 1000 },
    })
    expect(first.status()).toMatchObject({ revision: 7, assetCount: 1, clipCount: 1, markerCount: 1, editEventCount: 1 })
    first.close()

    const reopened = openContextBank(projectPath, 'project-1')
    try {
      expect(reopened.status()).toMatchObject({ revision: 7, assetCount: 1, clipCount: 1, markerCount: 1, editEventCount: 1 })
    } finally {
      reopened.close()
    }
  })

  it('keeps different project ids in separate databases', () => {
    const projectPath = projectFile()
    const one = openContextBank(projectPath, 'project-1')
    const two = openContextBank(projectPath, 'project-2')
    try {
      one.sync({ projectPath, mirror: mirror('project-1', 3) })
      expect(one.status().assetCount).toBe(1)
      expect(two.status()).toMatchObject({ projectId: 'project-2', revision: 0, assetCount: 0, clipCount: 0 })
      expect(contextBankPath(projectPath, 'project-1')).not.toBe(contextBankPath(projectPath, 'project-2'))
    } finally {
      two.close()
      one.close()
    }
  })
})

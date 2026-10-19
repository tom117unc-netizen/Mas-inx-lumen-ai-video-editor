import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
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

function seedSchemaV1(projectPath: string, projectId: string) {
  const file = contextBankPath(projectPath, projectId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  try {
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE source_assets (
        asset_id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, duration REAL,
        width INTEGER, height INTEGER, fps REAL, has_audio INTEGER, path TEXT NOT NULL,
        file_name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, mtime REAL,
        missing INTEGER NOT NULL DEFAULT 0, fingerprint TEXT
      );
      CREATE TABLE timeline_clips (
        sequence_id TEXT NOT NULL, clip_id TEXT NOT NULL, track_id TEXT NOT NULL, name TEXT NOT NULL,
        kind TEXT NOT NULL, start_frame INTEGER NOT NULL, duration_frames INTEGER NOT NULL, asset_id TEXT,
        in_point INTEGER NOT NULL, speed REAL NOT NULL, reverse INTEGER NOT NULL, freeze INTEGER NOT NULL,
        has_speed_ramp INTEGER NOT NULL, nested_sequence_id TEXT, PRIMARY KEY (sequence_id, clip_id)
      );
      CREATE TABLE timeline_markers (
        sequence_id TEXT NOT NULL, marker_id TEXT NOT NULL, frame INTEGER NOT NULL,
        label TEXT NOT NULL, color TEXT NOT NULL, PRIMARY KEY (sequence_id, marker_id)
      );
      CREATE TABLE edit_events (
        operation_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, kind TEXT NOT NULL,
        history_id INTEGER, label TEXT, source TEXT, at INTEGER NOT NULL
      );
    `)
    const meta = db.prepare('INSERT INTO meta(key,value) VALUES (?,?)')
    meta.run('schema_version', '1')
    meta.run('project_id', projectId)
    meta.run('project_path', projectPath)
    meta.run('last_revision', '5')
    db.prepare(`INSERT INTO source_assets(asset_id,name,kind,path,file_name,mime,size,missing,fingerprint)
      VALUES (?,?,?,?,?,?,?,?,?)`).run('asset-old', 'Old source', 'video', 'D:\\old.mkv', 'old.mkv', 'video/x-matroska', 10, 0, 'old-fingerprint')
    db.prepare(`INSERT INTO timeline_clips(sequence_id,clip_id,track_id,name,kind,start_frame,duration_frames,asset_id,in_point,speed,reverse,freeze,has_speed_ramp)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('main', 'clip-old', 'video-1', 'Old clip', 'video', 30, 60, 'asset-old', 0, 1, 0, 0, 0)
    db.prepare('INSERT INTO timeline_markers(sequence_id,marker_id,frame,label,color) VALUES (?,?,?,?,?)')
      .run('main', 'marker-old', 30, 'Old marker', 'red')
    db.prepare('INSERT INTO edit_events(operation_id,revision,kind,history_id,label,source,at) VALUES (?,?,?,?,?,?,?)')
      .run('dispatch:history:9', 5, 'dispatch', 9, 'Old edit', 'user', 50)
  } finally {
    db.close()
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

  it('opens idempotently with schema version 2', () => {
    const projectPath = projectFile()
    const first = openContextBank(projectPath, 'project-1')
    const second = openContextBank(projectPath, 'project-1')
    try {
      expect(first.status()).toMatchObject({ available: true, schemaVersion: 2, projectId: 'project-1', revision: 0 })
      expect(second.status()).toMatchObject({ available: true, schemaVersion: 2, projectId: 'project-1', revision: 0 })
    } finally {
      second.close()
      first.close()
    }
  })

  it('migrates a schema v1 database without losing mirrored state or edit history', () => {
    const projectPath = projectFile()
    seedSchemaV1(projectPath, 'project-1')
    const store = openContextBank(projectPath, 'project-1')
    try {
      expect(store.status()).toMatchObject({ schemaVersion: 2, revision: 5, assetCount: 1, clipCount: 1, markerCount: 1, editEventCount: 1 })
      const result = store.query({ projectPath, projectId: 'project-1', sequenceId: 'main', purpose: 'migration test', maxItems: 20, maxCharacters: 20_000 })
      expect(result.clips).toEqual([expect.objectContaining({ clipId: 'clip-old', assetId: 'asset-old' })])
      expect(result.markers).toEqual([expect.objectContaining({ markerId: 'marker-old', label: 'Old marker' })])
      expect(result.edits).toEqual([expect.objectContaining({ operationId: 'dispatch:history:9', label: 'Old edit' })])
    } finally {
      store.close()
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

  it('stores a source fingerprint, reuses it for timeline-only edits, and refreshes it when source metadata changes', () => {
    const projectPath = projectFile()
    const source = path.join(path.dirname(projectPath), 'episode01.mkv')
    fs.writeFileSync(source, Buffer.from('first-scene'))
    let stat = fs.statSync(source)
    const firstMirror = mirror('project-1', 1)
    Object.assign(firstMirror.assets[0], {
      path: source,
      fileName: path.basename(source),
      size: stat.size,
      mtime: Math.round(stat.mtimeMs),
    })
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.sync({ projectPath, mirror: firstMirror })
      const query = () => store.query({ projectPath, projectId: 'project-1', purpose: 'fingerprint test', maxItems: 20, maxCharacters: 20000 })
      const firstFingerprint = query().sources[0]?.fingerprint
      expect(firstFingerprint).toMatch(/^[a-f0-9]{64}$/)

      const moved = structuredClone(firstMirror)
      moved.revision = 2
      moved.sequences[0].clips[0].start = 240
      store.sync({ projectPath, mirror: moved })
      expect(query().sources[0]?.fingerprint).toBe(firstFingerprint)

      fs.writeFileSync(source, Buffer.from('second-scene-longer'))
      stat = fs.statSync(source)
      const changed = structuredClone(moved)
      changed.revision = 3
      changed.assets[0].size = stat.size
      changed.assets[0].mtime = Math.round(stat.mtimeMs)
      store.sync({ projectPath, mirror: changed })
      expect(query().sources[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/)
      expect(query().sources[0]?.fingerprint).not.toBe(firstFingerprint)
    } finally {
      store.close()
    }
  })
})

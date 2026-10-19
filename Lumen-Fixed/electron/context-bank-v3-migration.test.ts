import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { contextBankPath, openContextBank } from './context-bank'

const roots: string[] = []

function seedSchemaV2() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-context-v3-'))
  roots.push(root)
  const projectPath = path.join(root, 'review.lumen')
  const projectId = 'project-v2'
  const databasePath = contextBankPath(projectPath, projectId)
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const db = new DatabaseSync(databasePath)
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
      CREATE TABLE source_transcripts (
        transcript_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, asset_id TEXT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, language TEXT, analysis_version TEXT NOT NULL,
        created_at INTEGER NOT NULL, payload BLOB NOT NULL
      );
      CREATE TABLE source_observations (
        fingerprint TEXT NOT NULL, observation_id TEXT NOT NULL, asset_id TEXT NOT NULL,
        kind TEXT NOT NULL, start_seconds REAL NOT NULL, end_seconds REAL NOT NULL, text TEXT NOT NULL,
        confidence REAL, producer TEXT NOT NULL, model TEXT, source TEXT, created_at INTEGER NOT NULL,
        analysis_version TEXT NOT NULL, metadata_json TEXT, PRIMARY KEY (fingerprint, observation_id)
      );
    `)
    const meta = db.prepare('INSERT INTO meta(key,value) VALUES (?,?)')
    meta.run('schema_version', '2')
    meta.run('project_id', projectId)
    meta.run('project_path', projectPath)
    meta.run('last_revision', '9')

    db.prepare(`INSERT INTO source_assets(asset_id,name,kind,path,file_name,mime,size,missing,fingerprint)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      'asset-1', 'Narration', 'audio', path.join(root, 'narration.wav'), 'narration.wav', 'audio/wav', 100, 0, 'fingerprint-v2',
    )
    db.prepare(`INSERT INTO timeline_markers(sequence_id,marker_id,frame,label,color) VALUES (?,?,?,?,?)`)
      .run('main', 'marker-v2', 120, 'Existing marker', 'red')
    db.prepare(`INSERT INTO edit_events(operation_id,revision,kind,history_id,label,source,at) VALUES (?,?,?,?,?,?,?)`)
      .run('dispatch:history:3', 9, 'dispatch', 3, 'Existing edit', 'user', 900)

    const payload = gzipSync(Buffer.from(JSON.stringify({
      words: [{ start: 1, end: 1.4, text: 'remembered' }],
      segments: [{ start: 1, end: 1.4, text: 'remembered' }],
    }), 'utf8'))
    db.prepare(`INSERT INTO source_transcripts(
      transcript_id,fingerprint,asset_id,provider,model,language,analysis_version,created_at,payload
    ) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      'transcript-v2', 'fingerprint-v2', 'asset-1', 'elevenlabs', 'scribe_v2', 'en', 'scribe-v2', 1000, payload,
    )
    db.prepare(`INSERT INTO source_observations(
      fingerprint,observation_id,asset_id,kind,start_seconds,end_seconds,text,confidence,producer,model,source,created_at,analysis_version,metadata_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'fingerprint-v2', 'scene-v2', 'asset-1', 'scene', 10, 15, 'Existing verified scene.', 0.9,
      'media-analyzer', 'vision-v1', 'verified-media', 1100, 'scene-v1', '{}',
    )
  } finally {
    db.close()
  }
  return { projectPath, projectId }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Context Bank schema v3 migration', () => {
  it('migrates a v2 bank without losing timeline, transcript, or verified source memory', () => {
    const { projectPath, projectId } = seedSchemaV2()
    const store = openContextBank(projectPath, projectId)
    try {
      expect(store.status()).toMatchObject({ schemaVersion: 3, revision: 9, markerCount: 1, editEventCount: 1 })
      expect(store.getTranscript({
        projectPath,
        projectId,
        assetId: 'asset-1',
        maxWords: 20,
        maxSegments: 20,
        maxCharacters: 10_000,
      })).toMatchObject({ found: true, words: [{ start: 1, end: 1.4, text: 'remembered' }] })
      expect(store.getObservations({
        projectPath,
        projectId,
        assetId: 'asset-1',
        maxItems: 20,
        maxCharacters: 10_000,
      }).observations).toEqual([expect.objectContaining({ id: 'scene-v2', start: 10, end: 15 })])
      expect(store.getResearchStatus({ projectPath, projectId })).toMatchObject({ sourceCount: 0, chunkCount: 0, priorCount: 0 })
    } finally {
      store.close()
    }
  })
})

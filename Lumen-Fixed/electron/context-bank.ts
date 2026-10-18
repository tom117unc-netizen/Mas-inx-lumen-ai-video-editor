import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  ContextBankQuery,
  ContextBankQueryClip,
  ContextBankQueryEdit,
  ContextBankQueryMarker,
  ContextBankQueryResult,
  ContextBankQuerySource,
  ContextBankStatus,
  ContextBankSyncRequest,
} from '../shared/context-bank'

const SCHEMA_VERSION = 1
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

function requireProjectPath(projectPath: string) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) throw new Error('Context Bank requires a project path')
  if (!path.isAbsolute(projectPath)) throw new Error('Context Bank project path must be absolute')
  return path.resolve(projectPath)
}

function requireProjectId(projectId: string) {
  if (typeof projectId !== 'string' || !ID.test(projectId)) throw new Error('Invalid Context Bank project id')
  return projectId
}

export function contextBankPath(projectPath: string, projectId: string): string {
  const file = requireProjectPath(projectPath)
  const id = requireProjectId(projectId)
  return path.join(path.dirname(file), '.lumen-context', id, 'context.sqlite')
}

function bool(value: boolean | undefined) {
  return value === undefined ? null : value ? 1 : 0
}

function samePath(a: string, b: string) {
  const left = path.resolve(a)
  const right = path.resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function operationId(mutation: NonNullable<ContextBankSyncRequest['mutation']>) {
  return mutation.historyId !== undefined
    ? `${mutation.kind}:history:${mutation.historyId}`
    : `${mutation.kind}:revision:${mutation.revision}`
}

export interface ContextBankStore {
  sync(request: ContextBankSyncRequest): ContextBankStatus
  query(request: ContextBankQuery): ContextBankQueryResult
  status(): ContextBankStatus
  clear(): ContextBankStatus
  close(): void
}

class SqliteContextBankStore implements ContextBankStore {
  private readonly db: DatabaseSync
  private closed = false

  constructor(
    private readonly projectPath: string,
    private readonly projectId: string,
    readonly databasePath: string,
  ) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_assets (
        asset_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        duration REAL,
        width INTEGER,
        height INTEGER,
        fps REAL,
        has_audio INTEGER,
        path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime REAL,
        missing INTEGER NOT NULL DEFAULT 0,
        fingerprint TEXT
      );
      CREATE TABLE IF NOT EXISTS timeline_clips (
        sequence_id TEXT NOT NULL,
        clip_id TEXT NOT NULL,
        track_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_frame INTEGER NOT NULL,
        duration_frames INTEGER NOT NULL,
        asset_id TEXT,
        in_point INTEGER NOT NULL,
        speed REAL NOT NULL,
        reverse INTEGER NOT NULL,
        freeze INTEGER NOT NULL,
        has_speed_ramp INTEGER NOT NULL,
        nested_sequence_id TEXT,
        PRIMARY KEY (sequence_id, clip_id)
      );
      CREATE TABLE IF NOT EXISTS timeline_markers (
        sequence_id TEXT NOT NULL,
        marker_id TEXT NOT NULL,
        frame INTEGER NOT NULL,
        label TEXT NOT NULL,
        color TEXT NOT NULL,
        PRIMARY KEY (sequence_id, marker_id)
      );
      CREATE TABLE IF NOT EXISTS edit_events (
        operation_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        kind TEXT NOT NULL,
        history_id INTEGER,
        label TEXT,
        source TEXT,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_context_clips_range ON timeline_clips(sequence_id, start_frame);
      CREATE INDEX IF NOT EXISTS idx_context_markers_range ON timeline_markers(sequence_id, frame);
      CREATE INDEX IF NOT EXISTS idx_context_edits_revision ON edit_events(revision DESC, at DESC);
    `)
    this.setMeta('schema_version', String(SCHEMA_VERSION), false)
    const storedId = this.getMeta('project_id')
    if (storedId && storedId !== projectId) {
      this.db.close()
      throw new Error(`Context Bank belongs to another project (${storedId})`)
    }
    this.setMeta('project_id', projectId, false)
    this.setMeta('project_path', projectPath, false)
    if (this.getMeta('last_revision') === undefined) this.setMeta('last_revision', '0', false)
  }

  private ensureOpen() {
    if (this.closed) throw new Error('Context Bank is closed')
  }

  private getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value?: unknown } | undefined
    return typeof row?.value === 'string' ? row.value : undefined
  }

  private setMeta(key: string, value: string, check = true) {
    if (check) this.ensureOpen()
    this.db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)').run(key, value)
  }

  sync(request: ContextBankSyncRequest): ContextBankStatus {
    this.ensureOpen()
    if (!samePath(request.projectPath, this.projectPath)) throw new Error('Context Bank sync project path mismatch')
    if (request.mirror.projectId !== this.projectId) throw new Error('Context Bank sync project id mismatch')
    if (request.mirror.version !== 1 || request.mirror.format !== 'lumen-context-mirror') throw new Error('Unsupported Context Bank mirror version')

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec('DELETE FROM timeline_clips; DELETE FROM timeline_markers; DELETE FROM source_assets;')
      const insertAsset = this.db.prepare(`
        INSERT INTO source_assets(asset_id,name,kind,duration,width,height,fps,has_audio,path,file_name,mime,size,mtime,missing)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `)
      for (const asset of request.mirror.assets) {
        insertAsset.run(
          asset.id, asset.name, asset.kind, asset.duration ?? null, asset.width ?? null, asset.height ?? null,
          asset.fps ?? null, bool(asset.hasAudio), asset.path, asset.fileName, asset.mime, asset.size,
          asset.mtime ?? null, asset.missing ? 1 : 0,
        )
      }
      const insertClip = this.db.prepare(`
        INSERT INTO timeline_clips(sequence_id,clip_id,track_id,name,kind,start_frame,duration_frames,asset_id,in_point,speed,reverse,freeze,has_speed_ramp,nested_sequence_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `)
      const insertMarker = this.db.prepare(`
        INSERT INTO timeline_markers(sequence_id,marker_id,frame,label,color) VALUES (?,?,?,?,?)
      `)
      for (const sequence of request.mirror.sequences) {
        for (const clip of sequence.clips) {
          insertClip.run(
            sequence.id, clip.clipId, clip.trackId, clip.name, clip.kind, clip.start, clip.duration,
            clip.assetId ?? null, clip.inPoint, clip.speed, clip.reverse ? 1 : 0, clip.freeze ? 1 : 0,
            clip.hasSpeedRamp ? 1 : 0, clip.nestedSequenceId ?? null,
          )
        }
        for (const marker of sequence.markers) {
          insertMarker.run(sequence.id, marker.markerId, marker.frame, marker.label, marker.color)
        }
      }
      if (request.mutation) {
        const m = request.mutation
        this.db.prepare(`
          INSERT OR REPLACE INTO edit_events(operation_id,revision,kind,history_id,label,source,at)
          VALUES (?,?,?,?,?,?,?)
        `).run(operationId(m), m.revision, m.kind, m.historyId ?? null, m.label ?? null, m.source ?? null, m.at)
      }
      this.setMeta('last_revision', String(request.mirror.revision))
      this.setMeta('project_path', this.projectPath)
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* already rolled back */ }
      throw error
    }
    return this.status()
  }

  status(): ContextBankStatus {
    this.ensureOpen()
    const count = (table: string) => Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number | bigint }).n)
    return {
      available: true,
      projectId: this.projectId,
      projectPath: this.projectPath,
      databasePath: this.databasePath,
      schemaVersion: Number(this.getMeta('schema_version') ?? 0),
      revision: Number(this.getMeta('last_revision') ?? 0),
      assetCount: count('source_assets'),
      clipCount: count('timeline_clips'),
      markerCount: count('timeline_markers'),
      editEventCount: count('edit_events'),
      warnings: [],
    }
  }

  query(request: ContextBankQuery): ContextBankQueryResult {
    this.ensureOpen()
    if (request.projectId !== this.projectId || !samePath(request.projectPath, this.projectPath)) throw new Error('Context Bank query project mismatch')
    const maxItems = Math.max(1, Math.min(1000, Math.floor(request.maxItems)))
    const maxCharacters = Math.max(500, Math.min(1_000_000, Math.floor(request.maxCharacters)))
    const sequence = request.sequenceId
    const start = request.startFrame
    const end = request.endFrame
    const clips = this.db.prepare(`
      SELECT sequence_id,clip_id,track_id,name,kind,start_frame,duration_frames,asset_id,in_point,speed,reverse,freeze,has_speed_ramp
      FROM timeline_clips
      WHERE (? IS NULL OR sequence_id = ?)
        AND (? IS NULL OR start_frame + duration_frames > ?)
        AND (? IS NULL OR start_frame < ?)
      ORDER BY sequence_id,start_frame,clip_id LIMIT ?
    `).all(sequence ?? null, sequence ?? null, start ?? null, start ?? null, end ?? null, end ?? null, maxItems) as Record<string, unknown>[]
    const mappedClips: ContextBankQueryClip[] = clips.map(row => ({
      sequenceId: String(row.sequence_id), clipId: String(row.clip_id), trackId: String(row.track_id), name: String(row.name),
      kind: row.kind as ContextBankQueryClip['kind'], start: Number(row.start_frame), duration: Number(row.duration_frames),
      ...(row.asset_id ? { assetId: String(row.asset_id) } : {}), inPoint: Number(row.in_point), speed: Number(row.speed),
      reverse: Boolean(row.reverse), freeze: Boolean(row.freeze), hasSpeedRamp: Boolean(row.has_speed_ramp),
    }))
    const markers = this.db.prepare(`
      SELECT sequence_id,marker_id,frame,label,color FROM timeline_markers
      WHERE (? IS NULL OR sequence_id = ?)
        AND (? IS NULL OR frame >= ?)
        AND (? IS NULL OR frame < ?)
      ORDER BY sequence_id,frame,marker_id LIMIT ?
    `).all(sequence ?? null, sequence ?? null, start ?? null, start ?? null, end ?? null, end ?? null, maxItems) as Record<string, unknown>[]
    const mappedMarkers: ContextBankQueryMarker[] = markers.map(row => ({
      sequenceId: String(row.sequence_id), markerId: String(row.marker_id), frame: Number(row.frame), label: String(row.label), color: String(row.color),
    }))
    const assetIds = [...new Set(mappedClips.map(c => c.assetId).filter((id): id is string => Boolean(id)))].slice(0, maxItems)
    const mappedSources: ContextBankQuerySource[] = []
    const getAsset = this.db.prepare('SELECT asset_id,name,kind,path,size,mtime,fingerprint,missing FROM source_assets WHERE asset_id = ?')
    for (const id of assetIds) {
      const row = getAsset.get(id) as Record<string, unknown> | undefined
      if (!row) continue
      mappedSources.push({
        assetId: String(row.asset_id), name: String(row.name), kind: row.kind as ContextBankQuerySource['kind'], path: String(row.path),
        size: Number(row.size), ...(row.mtime === null || row.mtime === undefined ? {} : { mtime: Number(row.mtime) }),
        ...(row.fingerprint ? { fingerprint: String(row.fingerprint) } : {}), missing: Boolean(row.missing),
      })
    }
    const edits = this.db.prepare(`
      SELECT operation_id,revision,kind,history_id,label,source,at FROM edit_events
      ORDER BY revision DESC,at DESC,operation_id LIMIT ?
    `).all(maxItems) as Record<string, unknown>[]
    const mappedEdits: ContextBankQueryEdit[] = edits.map(row => ({
      operationId: String(row.operation_id), revision: Number(row.revision), kind: row.kind as ContextBankQueryEdit['kind'],
      ...(row.history_id === null || row.history_id === undefined ? {} : { historyId: Number(row.history_id) }),
      ...(row.label ? { label: String(row.label) } : {}), ...(row.source ? { source: row.source as ContextBankQueryEdit['source'] } : {}), at: Number(row.at),
    }))
    const result: ContextBankQueryResult = {
      projectId: this.projectId,
      revision: Number(this.getMeta('last_revision') ?? 0),
      clips: mappedClips,
      markers: mappedMarkers,
      sources: mappedSources,
      edits: mappedEdits,
      truncated: false,
      warnings: [],
    }
    if (JSON.stringify(result).length > maxCharacters) {
      result.truncated = true
      result.warnings.push('Context result exceeded the requested character budget; lower-priority items were omitted.')
      while (JSON.stringify(result).length > maxCharacters && result.edits.length) result.edits.pop()
      while (JSON.stringify(result).length > maxCharacters && result.sources.length) result.sources.pop()
      while (JSON.stringify(result).length > maxCharacters && result.markers.length) result.markers.pop()
      while (JSON.stringify(result).length > maxCharacters && result.clips.length) result.clips.pop()
    }
    return result
  }

  clear(): ContextBankStatus {
    this.ensureOpen()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec('DELETE FROM timeline_clips; DELETE FROM timeline_markers; DELETE FROM source_assets; DELETE FROM edit_events;')
      this.setMeta('last_revision', '0')
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* already rolled back */ }
      throw error
    }
    return this.status()
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }
}

export function openContextBank(projectPath: string, projectId: string): ContextBankStore {
  const resolvedProjectPath = requireProjectPath(projectPath)
  const id = requireProjectId(projectId)
  return new SqliteContextBankStore(resolvedProjectPath, id, contextBankPath(resolvedProjectPath, id))
}

export function copyContextBankForSaveAs(projectId: string, fromProjectPath: string, toProjectPath: string) {
  const source = contextBankPath(fromProjectPath, projectId)
  const target = contextBankPath(toProjectPath, projectId)
  if (!fs.existsSync(source)) return
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
  for (const suffix of ['-wal', '-shm']) {
    if (fs.existsSync(source + suffix)) fs.copyFileSync(source + suffix, target + suffix)
  }
}

export function clearContextBank(projectPath: string, projectId: string) {
  const store = openContextBank(projectPath, projectId)
  try { return store.clear() } finally { store.close() }
}

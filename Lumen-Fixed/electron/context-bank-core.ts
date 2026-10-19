import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gunzipSync, gzipSync } from 'node:zlib'
import type {
  ContextBankObservationQuery,
  ContextBankObservationResult,
  ContextBankObservationWriteRequest,
  ContextBankTranscriptQuery,
  ContextBankTranscriptResult,
  ContextBankTranscriptWriteRequest,
  ContextBankTranscriptWord,
  ContextBankTranscriptSegment,
} from '../shared/context-bank-analysis'
import { validateAnalysisVersion, validateSourceRange, validateTranscriptItems } from '../shared/context-bank-analysis'
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
import { fingerprintSourceFile } from './context-bank-fingerprint'
import { CONTEXT_BANK_RESEARCH_SCHEMA_SQL } from './context-bank-research'

const SCHEMA_VERSION = 3
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

function requireText(value: unknown, label: string, max = 256) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  if (value.length > max) throw new Error(`${label} is too long`)
  return value
}

function boundedCount(value: number, label: string, max: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number`)
  return Math.min(max, Math.floor(value))
}

function orderedTranscriptItems<T extends { start: number; end: number }>(items: readonly T[]) {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.start - b.item.start || a.item.end - b.item.end || a.index - b.index)
    .map(entry => entry.item)
}

function overlapsSourceRange(item: { start: number; end: number }, start?: number, end?: number) {
  return (start === undefined || item.end > start) && (end === undefined || item.start < end)
}

interface ExistingSource {
  asset_id: string
  path: string
  size: number | bigint
  mtime: number | null
  fingerprint: string | null
}

interface CurrentSource {
  fingerprint: string | null
  missing: number | bigint
}

interface TranscriptRow {
  transcript_id: string
  fingerprint: string
  asset_id: string
  provider: string
  model: string
  language: string | null
  analysis_version: string
  created_at: number | bigint
  payload: Uint8Array
}

interface TranscriptPayload {
  words: ContextBankTranscriptWord[]
  segments: ContextBankTranscriptSegment[]
}

export interface ContextBankStore {
  sync(request: ContextBankSyncRequest): ContextBankStatus
  query(request: ContextBankQuery): ContextBankQueryResult
  putTranscript(request: ContextBankTranscriptWriteRequest): ContextBankTranscriptResult
  getTranscript(request: ContextBankTranscriptQuery): ContextBankTranscriptResult
  putObservations(request: ContextBankObservationWriteRequest): ContextBankObservationResult
  getObservations(request: ContextBankObservationQuery): ContextBankObservationResult
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
    this.createFoundationSchema()
    const storedId = this.getMeta('project_id')
    if (storedId && storedId !== projectId) {
      this.db.close()
      throw new Error(`Context Bank belongs to another project (${storedId})`)
    }
    this.migrateSchema()
    this.setMeta('project_id', projectId, false)
    this.setMeta('project_path', projectPath, false)
    if (this.getMeta('last_revision') === undefined) this.setMeta('last_revision', '0', false)
  }

  private createFoundationSchema() {
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
  }

  private migrateSchema() {
    const raw = this.getMeta('schema_version')
    let version = raw === undefined ? 0 : Number(raw)
    if (!Number.isSafeInteger(version) || version < 0) throw new Error(`Invalid Context Bank schema version: ${raw}`)
    if (version > SCHEMA_VERSION) throw new Error(`Context Bank schema ${version} is newer than this Lumen build supports`)
    if (version === SCHEMA_VERSION) return

    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (version < 1) {
        this.setMeta('schema_version', '1', false)
        version = 1
      }
      if (version < 2) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS source_transcripts (
            transcript_id TEXT PRIMARY KEY,
            fingerprint TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            language TEXT,
            analysis_version TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            payload BLOB NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_context_transcripts_fingerprint ON source_transcripts(fingerprint);
          CREATE INDEX IF NOT EXISTS idx_context_transcripts_created ON source_transcripts(created_at DESC);
          CREATE TABLE IF NOT EXISTS source_observations (
            fingerprint TEXT NOT NULL,
            observation_id TEXT NOT NULL,
            asset_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            start_seconds REAL NOT NULL,
            end_seconds REAL NOT NULL,
            text TEXT NOT NULL,
            confidence REAL,
            producer TEXT NOT NULL,
            model TEXT,
            source TEXT,
            created_at INTEGER NOT NULL,
            analysis_version TEXT NOT NULL,
            metadata_json TEXT,
            PRIMARY KEY (fingerprint, observation_id)
          );
          CREATE INDEX IF NOT EXISTS idx_context_observations_range ON source_observations(fingerprint, start_seconds, end_seconds);
          CREATE INDEX IF NOT EXISTS idx_context_observations_kind ON source_observations(fingerprint, kind);
        `)
        this.setMeta('schema_version', '2', false)
        version = 2
      }
      if (version < 3) {
        try {
          this.db.exec(CONTEXT_BANK_RESEARCH_SCHEMA_SQL)
        } catch (error) {
          throw new Error(`Context Bank schema v3 requires SQLite FTS5: ${error instanceof Error ? error.message : String(error)}`)
        }
        this.setMeta('schema_version', '3', false)
        version = 3
      }
      this.db.exec('COMMIT')
    } catch (error) {
      try { this.db.exec('ROLLBACK') } catch { /* already rolled back */ }
      throw error
    }
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

  private requireMatchingProject(projectPath: string, projectId: string, action: string) {
    if (projectId !== this.projectId || !samePath(projectPath, this.projectPath)) throw new Error(`Context Bank ${action} project mismatch`)
  }

  private sourceForAsset(assetId: string): CurrentSource | undefined {
    return this.db.prepare('SELECT fingerprint,missing FROM source_assets WHERE asset_id = ?').get(assetId) as CurrentSource | undefined
  }

  private emptyTranscript(assetId: string, fingerprint = '', warning?: string): ContextBankTranscriptResult {
    return {
      projectId: this.projectId,
      assetId,
      fingerprint,
      found: false,
      words: [],
      segments: [],
      truncated: false,
      warnings: warning ? [warning] : [],
    }
  }

  sync(request: ContextBankSyncRequest): ContextBankStatus {
    this.ensureOpen()
    if (!samePath(request.projectPath, this.projectPath)) throw new Error('Context Bank sync project path mismatch')
    if (request.mirror.projectId !== this.projectId) throw new Error('Context Bank sync project id mismatch')
    if (request.mirror.version !== 1 || request.mirror.format !== 'lumen-context-mirror') throw new Error('Unsupported Context Bank mirror version')

    const previousSources = new Map(
      (this.db.prepare('SELECT asset_id,path,size,mtime,fingerprint FROM source_assets').all() as unknown as ExistingSource[])
        .map(row => [row.asset_id, row] as const),
    )

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.exec('DELETE FROM timeline_clips; DELETE FROM timeline_markers; DELETE FROM source_assets;')
      const insertAsset = this.db.prepare(`
        INSERT INTO source_assets(asset_id,name,kind,duration,width,height,fps,has_audio,path,file_name,mime,size,mtime,missing,fingerprint)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `)
      for (const asset of request.mirror.assets) {
        const previous = previousSources.get(asset.id)
        const sameIdentity = Boolean(
          previous?.fingerprint
          && samePath(previous.path, asset.path)
          && Number(previous.size) === asset.size
          && (previous.mtime === null ? asset.mtime === undefined : Number(previous.mtime) === asset.mtime),
        )
        let fingerprint = sameIdentity ? previous!.fingerprint : null
        if (!fingerprint && !asset.missing) {
          try {
            fingerprint = fingerprintSourceFile(asset.path).fingerprint
          } catch {
            // Media can disappear between the renderer mirror and this sync.
            // Keep the canonical timeline mirrored and leave fingerprint unknown.
          }
        }
        insertAsset.run(
          asset.id, asset.name, asset.kind, asset.duration ?? null, asset.width ?? null, asset.height ?? null,
          asset.fps ?? null, bool(asset.hasAudio), asset.path, asset.fileName, asset.mime, asset.size,
          asset.mtime ?? null, asset.missing ? 1 : 0, fingerprint,
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

  putTranscript(request: ContextBankTranscriptWriteRequest): ContextBankTranscriptResult {
    this.ensureOpen()
    this.requireMatchingProject(request.projectPath, request.projectId, 'transcript write')
    requireText(request.assetId, 'Transcript asset id', 256)
    requireText(request.provider, 'Transcript provider')
    requireText(request.model, 'Transcript model')
    if (request.language !== undefined) requireText(request.language, 'Transcript language', 64)
    validateAnalysisVersion(request.analysisVersion)
    if (!Array.isArray(request.words) || !Array.isArray(request.segments)) throw new Error('Transcript words and segments must be arrays')
    validateTranscriptItems(request.words)
    validateTranscriptItems(request.segments)
    if (!Number.isFinite(request.createdAt) || request.createdAt < 0) throw new Error('Transcript createdAt must be a non-negative finite number')

    const source = this.sourceForAsset(request.assetId)
    if (!source || Number(source.missing) !== 0 || !source.fingerprint) throw new Error('Current source fingerprint is unavailable for this asset')
    const payload: TranscriptPayload = { words: request.words, segments: request.segments }
    const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))
    this.db.prepare(`
      INSERT INTO source_transcripts(transcript_id,fingerprint,asset_id,provider,model,language,analysis_version,created_at,payload)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      randomUUID(), source.fingerprint, request.assetId, request.provider, request.model, request.language ?? null,
      request.analysisVersion, Math.floor(request.createdAt), compressed,
    )
    return {
      projectId: this.projectId,
      assetId: request.assetId,
      fingerprint: source.fingerprint,
      found: true,
      provider: request.provider,
      model: request.model,
      ...(request.language ? { language: request.language } : {}),
      analysisVersion: request.analysisVersion,
      createdAt: Math.floor(request.createdAt),
      words: request.words,
      segments: request.segments,
      truncated: false,
      warnings: [],
    }
  }

  getTranscript(request: ContextBankTranscriptQuery): ContextBankTranscriptResult {
    this.ensureOpen()
    this.requireMatchingProject(request.projectPath, request.projectId, 'transcript query')
    requireText(request.assetId, 'Transcript asset id', 256)
    validateSourceRange(request.startSeconds, request.endSeconds)
    const maxWords = boundedCount(request.maxWords, 'maxWords', 100_000)
    const maxSegments = boundedCount(request.maxSegments, 'maxSegments', 100_000)
    const maxCharacters = Math.max(500, boundedCount(request.maxCharacters, 'maxCharacters', 1_000_000))

    const source = this.sourceForAsset(request.assetId)
    if (!source?.fingerprint) return this.emptyTranscript(request.assetId, '', 'No current source fingerprint is available for this asset.')
    const row = this.db.prepare(`
      SELECT transcript_id,fingerprint,asset_id,provider,model,language,analysis_version,created_at,payload
      FROM source_transcripts WHERE fingerprint = ? ORDER BY created_at DESC, transcript_id DESC LIMIT 1
    `).get(source.fingerprint) as TranscriptRow | undefined
    if (!row) return this.emptyTranscript(request.assetId, source.fingerprint)

    const payload = JSON.parse(gunzipSync(Buffer.from(row.payload)).toString('utf8')) as TranscriptPayload
    const filteredWords = orderedTranscriptItems(payload.words)
      .filter(item => overlapsSourceRange(item, request.startSeconds, request.endSeconds))
    const filteredSegments = orderedTranscriptItems(payload.segments)
      .filter(item => overlapsSourceRange(item, request.startSeconds, request.endSeconds))
    const words = filteredWords.slice(0, maxWords)
    const segments = filteredSegments.slice(0, maxSegments)
    let truncated = words.length < filteredWords.length || segments.length < filteredSegments.length

    const result: ContextBankTranscriptResult = {
      projectId: this.projectId,
      assetId: request.assetId,
      fingerprint: row.fingerprint,
      found: true,
      provider: row.provider,
      model: row.model,
      ...(row.language ? { language: row.language } : {}),
      analysisVersion: row.analysis_version,
      createdAt: Number(row.created_at),
      words,
      segments,
      truncated,
      warnings: truncated ? ['Transcript result was truncated to the requested budget.'] : [],
    }

    if (JSON.stringify(result).length > maxCharacters) {
      truncated = true
      result.truncated = true
      if (!result.warnings.length) result.warnings.push('Transcript result was truncated to the requested budget.')
      while (JSON.stringify(result).length > maxCharacters && (result.words.length || result.segments.length)) {
        const word = result.words.at(-1)
        const segment = result.segments.at(-1)
        if (!word) result.segments.pop()
        else if (!segment) result.words.pop()
        else if (segment.start > word.start || (segment.start === word.start && segment.end >= word.end)) result.segments.pop()
        else result.words.pop()
      }
    }
    return result
  }

  putObservations(_request: ContextBankObservationWriteRequest): ContextBankObservationResult {
    throw new Error('Context Bank source observations are not implemented yet')
  }

  getObservations(_request: ContextBankObservationQuery): ContextBankObservationResult {
    throw new Error('Context Bank source observations are not implemented yet')
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
      this.db.exec('DELETE FROM timeline_clips; DELETE FROM timeline_markers; DELETE FROM source_assets; DELETE FROM edit_events; DELETE FROM source_transcripts; DELETE FROM source_observations;')
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

  // Flush committed WAL pages into the main database before copying. Sync writes are
  // serialized before Save As, so this connection only needs to checkpoint an idle DB.
  const checkpoint = new DatabaseSync(source)
  try {
    checkpoint.exec('PRAGMA busy_timeout=5000; PRAGMA wal_checkpoint(TRUNCATE);')
  } finally {
    checkpoint.close()
  }

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.rmSync(target, { force: true })
  fs.rmSync(`${target}-wal`, { force: true })
  fs.rmSync(`${target}-shm`, { force: true })
  fs.copyFileSync(source, target)
}

export function clearContextBank(projectPath: string, projectId: string) {
  const store = openContextBank(projectPath, projectId)
  try { return store.clear() } finally { store.close() }
}

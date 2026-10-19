import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  ContextBankObservationInput,
  ContextBankObservationQuery,
  ContextBankObservationResult,
  ContextBankObservationWriteRequest,
  ContextBankPrimitive,
} from '../shared/context-bank-analysis'
import { validateObservationInput, validateSourceRange } from '../shared/context-bank-analysis'

const MAX_OBSERVATIONS_PER_WRITE = 10_000
const MAX_OBSERVATIONS_PER_QUERY = 10_000
const MAX_RESULT_CHARACTERS = 1_000_000

interface CurrentSourceRow {
  fingerprint: string | null
  missing: number | bigint
}

interface ObservationRow {
  observation_id: string
  kind: string
  start_seconds: number
  end_seconds: number
  text: string
  confidence: number | null
  producer: string
  model: string | null
  source: string | null
  created_at: number | bigint
  analysis_version: string
  metadata_json: string | null
}

function samePath(a: string, b: string) {
  const left = path.resolve(a)
  const right = path.resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function requireMatchingProject(expectedPath: string, expectedProjectId: string, requestPath: string, requestProjectId: string, action: string) {
  if (requestProjectId !== expectedProjectId || !samePath(requestPath, expectedPath)) {
    throw new Error(`Context Bank ${action} project mismatch`)
  }
}

function requireText(value: unknown, label: string, max: number) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  if (value.length > max) throw new Error(`${label} is too long`)
  return value
}

function boundedCount(value: number, label: string, max: number) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number`)
  return Math.min(max, Math.floor(value))
}

function currentSource(db: DatabaseSync, assetId: string): CurrentSourceRow | undefined {
  return db.prepare('SELECT fingerprint,missing FROM source_assets WHERE asset_id = ?').get(assetId) as CurrentSourceRow | undefined
}

function orderObservations(items: readonly ContextBankObservationInput[]) {
  return [...items].sort((a, b) =>
    a.start - b.start
    || a.end - b.end
    || a.kind.localeCompare(b.kind)
    || a.id.localeCompare(b.id),
  )
}

function normalizedObservation(input: ContextBankObservationInput): ContextBankObservationInput {
  return {
    id: input.id,
    kind: input.kind,
    start: input.start,
    end: input.end,
    text: input.text,
    ...(input.confidence === undefined ? {} : { confidence: input.confidence }),
    provenance: {
      producer: input.provenance.producer,
      ...(input.provenance.model === undefined ? {} : { model: input.provenance.model }),
      ...(input.provenance.source === undefined ? {} : { source: input.provenance.source }),
      createdAt: Math.floor(input.provenance.createdAt),
      ...(input.provenance.metadata === undefined ? {} : { metadata: { ...input.provenance.metadata } }),
    },
    analysisVersion: input.analysisVersion,
  }
}

function parseMetadata(value: string | null): Record<string, ContextBankPrimitive> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return parsed as Record<string, ContextBankPrimitive>
  } catch {
    return undefined
  }
}

function mapRow(row: ObservationRow): ContextBankObservationInput {
  const metadata = parseMetadata(row.metadata_json)
  return {
    id: row.observation_id,
    kind: row.kind,
    start: Number(row.start_seconds),
    end: Number(row.end_seconds),
    text: row.text,
    ...(row.confidence === null ? {} : { confidence: Number(row.confidence) }),
    provenance: {
      producer: row.producer,
      ...(row.model ? { model: row.model } : {}),
      ...(row.source ? { source: row.source } : {}),
      createdAt: Number(row.created_at),
      ...(metadata ? { metadata } : {}),
    },
    analysisVersion: row.analysis_version,
  }
}

export function putSourceObservations(
  databasePath: string,
  expectedProjectPath: string,
  expectedProjectId: string,
  request: ContextBankObservationWriteRequest,
): ContextBankObservationResult {
  requireMatchingProject(expectedProjectPath, expectedProjectId, request.projectPath, request.projectId, 'observation write')
  requireText(request.assetId, 'Observation asset id', 256)
  if (!Array.isArray(request.observations)) throw new Error('Observations must be an array')
  if (request.observations.length > MAX_OBSERVATIONS_PER_WRITE) throw new Error('Too many observations in one write')

  // Validate the complete batch before opening a write transaction, so a bad
  // observation cannot leave a partially updated source map behind.
  const unique = new Map<string, ContextBankObservationInput>()
  for (const input of request.observations) {
    validateObservationInput(input)
    unique.set(input.id, normalizedObservation(input))
  }
  const observations = orderObservations([...unique.values()])

  const db = new DatabaseSync(databasePath)
  try {
    db.exec('PRAGMA busy_timeout=5000;')
    const source = currentSource(db, request.assetId)
    if (!source || Number(source.missing) !== 0 || !source.fingerprint) {
      throw new Error('Current source fingerprint is unavailable for this asset')
    }

    const upsert = db.prepare(`
      INSERT INTO source_observations(
        fingerprint,observation_id,asset_id,kind,start_seconds,end_seconds,text,confidence,
        producer,model,source,created_at,analysis_version,metadata_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(fingerprint,observation_id) DO UPDATE SET
        asset_id=excluded.asset_id,
        kind=excluded.kind,
        start_seconds=excluded.start_seconds,
        end_seconds=excluded.end_seconds,
        text=excluded.text,
        confidence=excluded.confidence,
        producer=excluded.producer,
        model=excluded.model,
        source=excluded.source,
        created_at=excluded.created_at,
        analysis_version=excluded.analysis_version,
        metadata_json=excluded.metadata_json
    `)

    db.exec('BEGIN IMMEDIATE')
    try {
      for (const item of observations) {
        upsert.run(
          source.fingerprint,
          item.id,
          request.assetId,
          item.kind,
          item.start,
          item.end,
          item.text,
          item.confidence ?? null,
          item.provenance.producer,
          item.provenance.model ?? null,
          item.provenance.source ?? null,
          item.provenance.createdAt,
          item.analysisVersion,
          item.provenance.metadata ? JSON.stringify(item.provenance.metadata) : null,
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* already rolled back */ }
      throw error
    }

    return {
      projectId: expectedProjectId,
      assetId: request.assetId,
      fingerprint: source.fingerprint,
      observations,
      truncated: false,
      warnings: [],
    }
  } finally {
    db.close()
  }
}

export function getSourceObservations(
  databasePath: string,
  expectedProjectPath: string,
  expectedProjectId: string,
  request: ContextBankObservationQuery,
): ContextBankObservationResult {
  requireMatchingProject(expectedProjectPath, expectedProjectId, request.projectPath, request.projectId, 'observation query')
  requireText(request.assetId, 'Observation asset id', 256)
  validateSourceRange(request.startSeconds, request.endSeconds)
  if (request.kind !== undefined) requireText(request.kind, 'Observation kind', 128)
  const maxItems = boundedCount(request.maxItems, 'maxItems', MAX_OBSERVATIONS_PER_QUERY)
  const maxCharacters = Math.max(500, boundedCount(request.maxCharacters, 'maxCharacters', MAX_RESULT_CHARACTERS))

  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout=5000;')
    const source = currentSource(db, request.assetId)
    if (!source?.fingerprint) {
      return {
        projectId: expectedProjectId,
        assetId: request.assetId,
        fingerprint: '',
        observations: [],
        truncated: false,
        warnings: ['No current source fingerprint is available for this asset.'],
      }
    }

    let sql = `
      SELECT observation_id,kind,start_seconds,end_seconds,text,confidence,producer,model,source,created_at,analysis_version,metadata_json
      FROM source_observations WHERE fingerprint = ?
    `
    const args: (string | number)[] = [source.fingerprint]
    if (request.kind !== undefined) {
      sql += ' AND kind = ?'
      args.push(request.kind)
    }
    if (request.startSeconds !== undefined) {
      sql += ' AND end_seconds > ?'
      args.push(request.startSeconds)
    }
    if (request.endSeconds !== undefined) {
      sql += ' AND start_seconds < ?'
      args.push(request.endSeconds)
    }
    sql += ' ORDER BY start_seconds ASC,end_seconds ASC,kind ASC,observation_id ASC LIMIT ?'
    args.push(maxItems + 1)

    const rows = db.prepare(sql).all(...args) as unknown as ObservationRow[]
    const observations = rows.slice(0, maxItems).map(mapRow)
    let truncated = rows.length > maxItems
    const result: ContextBankObservationResult = {
      projectId: expectedProjectId,
      assetId: request.assetId,
      fingerprint: source.fingerprint,
      observations,
      truncated,
      warnings: truncated ? ['Observation result was truncated to the requested budget.'] : [],
    }

    if (JSON.stringify(result).length > maxCharacters) {
      truncated = true
      result.truncated = true
      if (!result.warnings.length) result.warnings.push('Observation result was truncated to the requested budget.')
      while (JSON.stringify(result).length > maxCharacters && result.observations.length) result.observations.pop()
    }
    return result
  } finally {
    db.close()
  }
}

import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  ContextBankResearchChunkHit,
  ContextBankResearchPrior,
  ContextBankResearchPriorWriteRequest,
  ContextBankResearchPriorWriteResult,
  ContextBankResearchSearchRequest,
  ContextBankResearchSearchResult,
  ContextBankResearchSeedWriteRequest,
  ContextBankResearchState,
  ContextBankResearchStateWriteRequest,
  ContextBankResearchStatusRequest,
  ContextBankResearchStatusResult,
} from '../shared/context-bank-research'
import {
  validatePublicResearchUrl,
  validateResearchPrior,
  validateResearchSearchRequest,
  validateResearchSeedWriteRequest,
  validateResearchStateWriteRequest,
} from '../shared/context-bank-research'

export const CONTEXT_BANK_RESEARCH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS show_research_state (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    state_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS research_sources (
    source_id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    title TEXT,
    site TEXT,
    retrieved_at INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    text TEXT NOT NULL,
    UNIQUE(normalized_url, content_hash)
  );
  CREATE TABLE IF NOT EXISTS research_chunks (
    chunk_id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    heading TEXT,
    text TEXT NOT NULL,
    episode_number INTEGER,
    FOREIGN KEY(source_id) REFERENCES research_sources(source_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_research_chunks_source ON research_chunks(source_id, ordinal, chunk_id);
  CREATE TABLE IF NOT EXISTS research_priors (
    prior_id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    text TEXT NOT NULL,
    episode_number INTEGER,
    position_hint TEXT,
    confidence REAL NOT NULL,
    source_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    excerpt TEXT NOT NULL,
    producer TEXT NOT NULL,
    analysis_version TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    prior_json TEXT NOT NULL,
    FOREIGN KEY(source_id) REFERENCES research_sources(source_id) ON DELETE CASCADE,
    FOREIGN KEY(chunk_id) REFERENCES research_chunks(chunk_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_research_priors_created ON research_priors(created_at DESC, prior_id);
  CREATE VIRTUAL TABLE IF NOT EXISTS research_chunks_fts USING fts5(
    chunk_id UNINDEXED,
    heading,
    text,
    tokenize='unicode61 remove_diacritics 2'
  );
`

function samePath(a: string, b: string) {
  const left = path.resolve(a)
  const right = path.resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function withDatabase<T>(databasePath: string, fn: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(databasePath)
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    return fn(db)
  } finally {
    db.close()
  }
}

function requireProject(db: DatabaseSync, projectPath: string, projectId: string, action: string) {
  const id = db.prepare("SELECT value FROM meta WHERE key = 'project_id'").get() as { value?: unknown } | undefined
  const storedPath = db.prepare("SELECT value FROM meta WHERE key = 'project_path'").get() as { value?: unknown } | undefined
  if (id?.value !== projectId || typeof storedPath?.value !== 'string' || !samePath(storedPath.value, projectPath)) {
    throw new Error(`Context Bank ${action} project mismatch`)
  }
}

function ensureResearchSchema(db: DatabaseSync) {
  try {
    db.exec(CONTEXT_BANK_RESEARCH_SCHEMA_SQL)
  } catch (error) {
    throw new Error(`Context Bank research schema requires SQLite FTS5: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseState(value: unknown): ContextBankResearchState | undefined {
  if (typeof value !== 'string' || !value) return undefined
  try { return JSON.parse(value) as ContextBankResearchState } catch { return undefined }
}

function status(db: DatabaseSync, projectId: string): ContextBankResearchStatusResult {
  const row = db.prepare('SELECT state_json FROM show_research_state WHERE singleton = 1').get() as { state_json?: unknown } | undefined
  const count = (table: string) => Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number | bigint } | undefined)?.count ?? 0)
  return {
    projectId,
    ...(parseState(row?.state_json) ? { state: parseState(row?.state_json)! } : {}),
    sourceCount: count('research_sources'),
    chunkCount: count('research_chunks'),
    priorCount: count('research_priors'),
    warnings: [],
  }
}

function writeState(db: DatabaseSync, state: ContextBankResearchState) {
  db.prepare('INSERT OR REPLACE INTO show_research_state(singleton,state_json) VALUES (1,?)').run(JSON.stringify(state))
}

function normalizedEvidenceText(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')
}

function priorMatchesChunk(db: DatabaseSync, prior: ContextBankResearchPrior) {
  const row = db.prepare('SELECT source_id,text FROM research_chunks WHERE chunk_id = ?').get(prior.evidence.chunkId) as { source_id?: unknown; text?: unknown } | undefined
  if (!row || row.source_id !== prior.evidence.sourceId || typeof row.text !== 'string') return false
  return normalizedEvidenceText(row.text).includes(normalizedEvidenceText(prior.evidence.excerpt))
}

function putPriorRow(db: DatabaseSync, prior: ContextBankResearchPrior) {
  db.prepare(`
    INSERT INTO research_priors(
      prior_id,query,text,episode_number,position_hint,confidence,source_id,chunk_id,excerpt,producer,analysis_version,created_at,prior_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(prior_id) DO UPDATE SET
      query=excluded.query,
      text=excluded.text,
      episode_number=excluded.episode_number,
      position_hint=excluded.position_hint,
      confidence=excluded.confidence,
      source_id=excluded.source_id,
      chunk_id=excluded.chunk_id,
      excerpt=excluded.excerpt,
      producer=excluded.producer,
      analysis_version=excluded.analysis_version,
      created_at=excluded.created_at,
      prior_json=excluded.prior_json
  `).run(
    prior.id,
    prior.query,
    prior.text,
    prior.episodeNumber ?? null,
    prior.positionHint ?? null,
    prior.confidence,
    prior.evidence.sourceId,
    prior.evidence.chunkId,
    prior.evidence.excerpt,
    prior.provenance.producer,
    prior.provenance.analysisVersion,
    prior.provenance.createdAt,
    JSON.stringify(prior),
  )
}

export function getShowResearchStatus(
  databasePath: string,
  projectPath: string,
  projectId: string,
  request: ContextBankResearchStatusRequest,
): ContextBankResearchStatusResult {
  if (request.projectId !== projectId || !samePath(request.projectPath, projectPath)) throw new Error('Context Bank research status project mismatch')
  return withDatabase(databasePath, db => {
    requireProject(db, projectPath, projectId, 'research status')
    ensureResearchSchema(db)
    return status(db, projectId)
  })
}

export function setShowResearchState(
  databasePath: string,
  projectPath: string,
  projectId: string,
  request: ContextBankResearchStateWriteRequest,
): ContextBankResearchStatusResult {
  validateResearchStateWriteRequest(request)
  if (request.projectId !== projectId || !samePath(request.projectPath, projectPath)) throw new Error('Context Bank research state project mismatch')
  return withDatabase(databasePath, db => {
    requireProject(db, projectPath, projectId, 'research state write')
    ensureResearchSchema(db)
    writeState(db, request.state)
    return status(db, projectId)
  })
}

export function replaceShowResearchSeed(
  databasePath: string,
  projectPath: string,
  projectId: string,
  request: ContextBankResearchSeedWriteRequest,
): ContextBankResearchStatusResult {
  validateResearchSeedWriteRequest(request)
  if (request.projectId !== projectId || !samePath(request.projectPath, projectPath)) throw new Error('Context Bank research seed project mismatch')
  return withDatabase(databasePath, db => {
    requireProject(db, projectPath, projectId, 'research seed write')
    ensureResearchSchema(db)
    const oldPriors = (db.prepare('SELECT prior_json FROM research_priors ORDER BY created_at,prior_id').all() as unknown as { prior_json: string }[])
      .map(row => {
        try { return JSON.parse(row.prior_json) as ContextBankResearchPrior } catch { return undefined }
      })
      .filter((item): item is ContextBankResearchPrior => Boolean(item))

    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('DELETE FROM research_priors; DELETE FROM research_chunks_fts; DELETE FROM research_chunks; DELETE FROM research_sources;')
      writeState(db, request.state)
      const insertSource = db.prepare(`
        INSERT INTO research_sources(source_id,url,normalized_url,title,site,retrieved_at,content_hash,text)
        VALUES (?,?,?,?,?,?,?,?)
      `)
      for (const source of request.sources) {
        insertSource.run(
          source.id,
          source.url,
          validatePublicResearchUrl(source.url),
          source.title ?? null,
          source.site ?? null,
          source.retrievedAt,
          source.contentHash,
          source.text,
        )
      }
      const insertChunk = db.prepare(`
        INSERT INTO research_chunks(chunk_id,source_id,ordinal,heading,text,episode_number)
        VALUES (?,?,?,?,?,?)
      `)
      const insertFts = db.prepare('INSERT INTO research_chunks_fts(chunk_id,heading,text) VALUES (?,?,?)')
      for (const chunk of request.chunks) {
        insertChunk.run(chunk.id, chunk.sourceId, chunk.ordinal, chunk.heading ?? null, chunk.text, chunk.episodeNumber ?? null)
        insertFts.run(chunk.id, chunk.heading ?? '', chunk.text)
      }
      for (const prior of oldPriors) {
        try {
          validateResearchPrior(prior)
          if (priorMatchesChunk(db, prior)) putPriorRow(db, prior)
        } catch {
          // Source replacement invalidates stale or malformed research priors.
        }
      }
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* already rolled back */ }
      throw error
    }
    return status(db, projectId)
  })
}

function queryTokens(value: string) {
  const tokens = value.normalize('NFKC').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]+/gu) ?? []
  return [...new Set(tokens)].slice(0, 24)
}

function ftsExpression(tokens: readonly string[], operator: 'AND' | 'OR' = 'AND') {
  return tokens.map(token => `"${token.replace(/"/g, '""')}"`).join(` ${operator} `)
}

function priorScore(prior: ContextBankResearchPrior, tokens: readonly string[]) {
  const haystack = normalizedEvidenceText(`${prior.query} ${prior.text}`)
  const hits = tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0)
  return tokens.length ? hits / tokens.length : 0
}

function researchChunkRows(db: DatabaseSync, fts: string, limit: number) {
  return db.prepare(`
    SELECT c.chunk_id,c.source_id,c.ordinal,c.heading,c.text,c.episode_number,
           s.url AS source_url,s.title AS source_title,s.site,
           bm25(research_chunks_fts) AS rank
    FROM research_chunks_fts
    JOIN research_chunks c ON c.chunk_id = research_chunks_fts.chunk_id
    JOIN research_sources s ON s.source_id = c.source_id
    WHERE research_chunks_fts MATCH ?
    ORDER BY rank ASC,c.source_id,c.ordinal,c.chunk_id
    LIMIT ?
  `).all(fts, limit) as unknown as Record<string, unknown>[]
}

function rowTokenHits(row: Record<string, unknown>, tokens: readonly string[]) {
  const haystack = normalizedEvidenceText(`${row.heading ?? ''} ${row.text ?? ''}`)
  return tokens.reduce((count, token) => count + (haystack.includes(token) ? 1 : 0), 0)
}

export function searchShowResearch(
  databasePath: string,
  projectPath: string,
  projectId: string,
  request: ContextBankResearchSearchRequest,
): ContextBankResearchSearchResult {
  validateResearchSearchRequest(request)
  if (request.projectId !== projectId || !samePath(request.projectPath, projectPath)) throw new Error('Context Bank research search project mismatch')
  return withDatabase(databasePath, db => {
    requireProject(db, projectPath, projectId, 'research search')
    ensureResearchSchema(db)
    const tokens = queryTokens(request.query)
    if (!tokens.length) return { projectId, priors: [], chunks: [], truncated: false, warnings: [] }

    const priorRows = db.prepare('SELECT prior_json FROM research_priors ORDER BY created_at DESC,prior_id LIMIT 200').all() as unknown as { prior_json: string }[]
    const matchingPriors = priorRows
      .map(row => {
        try { return JSON.parse(row.prior_json) as ContextBankResearchPrior } catch { return undefined }
      })
      .filter((item): item is ContextBankResearchPrior => Boolean(item))
      .map(item => ({ item, score: priorScore(item, tokens) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.item.confidence - a.item.confidence || a.item.id.localeCompare(b.item.id))
      .map(entry => entry.item)

    let rows = researchChunkRows(db, ftsExpression(tokens), 100)
    let relaxed = false
    if (!rows.length && tokens.length > 1) {
      const minimumHits = tokens.length >= 3 ? 2 : 1
      rows = researchChunkRows(db, ftsExpression(tokens, 'OR'), 200)
        .map(row => ({ row, hits: rowTokenHits(row, tokens) }))
        .filter(entry => entry.hits >= minimumHits)
        .sort((a, b) => (
          b.hits - a.hits
          || Number(a.row.rank ?? 0) - Number(b.row.rank ?? 0)
          || String(a.row.source_id).localeCompare(String(b.row.source_id))
          || Number(a.row.ordinal) - Number(b.row.ordinal)
          || String(a.row.chunk_id).localeCompare(String(b.row.chunk_id))
        ))
        .map(entry => entry.row)
      relaxed = rows.length > 0
    }

    const preferredChunkIds = new Set(matchingPriors.map(prior => prior.evidence.chunkId))
    const matchingChunks: ContextBankResearchChunkHit[] = rows
      .filter(row => !preferredChunkIds.has(String(row.chunk_id)))
      .map(row => {
        const coverage = tokens.length ? rowTokenHits(row, tokens) / tokens.length : 0
        return {
          id: String(row.chunk_id),
          sourceId: String(row.source_id),
          ordinal: Number(row.ordinal),
          ...(row.heading ? { heading: String(row.heading) } : {}),
          text: String(row.text),
          ...(row.episode_number === null || row.episode_number === undefined ? {} : { episodeNumber: Number(row.episode_number) }),
          sourceUrl: String(row.source_url),
          ...(row.source_title ? { sourceTitle: String(row.source_title) } : {}),
          ...(row.site ? { site: String(row.site) } : {}),
          score: relaxed ? coverage : 1 / (1 + Math.abs(Number(row.rank ?? 0))),
        }
      })

    const allCount = matchingPriors.length + matchingChunks.length
    const priors = matchingPriors.slice(0, request.maxItems)
    const chunks = matchingChunks.slice(0, Math.max(0, request.maxItems - priors.length))
    const result: ContextBankResearchSearchResult = {
      projectId,
      priors,
      chunks,
      truncated: allCount > priors.length + chunks.length,
      warnings: relaxed ? ['Research search relaxed because no chunk matched all query terms.'] : [],
    }

    while (JSON.stringify(result).length > request.maxCharacters && result.chunks.length) {
      result.chunks.pop()
      result.truncated = true
    }
    while (JSON.stringify(result).length > request.maxCharacters && result.priors.length) {
      result.priors.pop()
      result.truncated = true
    }
    if (result.truncated) result.warnings.push('Research result truncated.')
    while (JSON.stringify(result).length > request.maxCharacters && result.warnings.length) result.warnings.pop()
    return result
  })
}

export function putShowResearchPrior(
  databasePath: string,
  projectPath: string,
  projectId: string,
  request: ContextBankResearchPriorWriteRequest,
): ContextBankResearchPriorWriteResult {
  validateResearchPrior(request.prior)
  if (request.projectId !== projectId || !samePath(request.projectPath, projectPath)) throw new Error('Context Bank research prior project mismatch')
  return withDatabase(databasePath, db => {
    requireProject(db, projectPath, projectId, 'research prior write')
    ensureResearchSchema(db)
    const row = db.prepare('SELECT source_id,text FROM research_chunks WHERE chunk_id = ?').get(request.prior.evidence.chunkId) as { source_id?: unknown; text?: unknown } | undefined
    if (!row || row.source_id !== request.prior.evidence.sourceId || typeof row.text !== 'string') {
      throw new Error('Research prior evidence chunk does not exist for the cited source')
    }
    if (!normalizedEvidenceText(row.text).includes(normalizedEvidenceText(request.prior.evidence.excerpt))) {
      throw new Error('Research prior evidence excerpt must match text in the cited chunk')
    }
    const existed = Boolean(db.prepare('SELECT 1 AS present FROM research_priors WHERE prior_id = ?').get(request.prior.id))
    putPriorRow(db, request.prior)
    return { projectId, prior: request.prior, created: !existed, warnings: [] }
  })
}

export function clearShowResearch(databasePath: string) {
  return withDatabase(databasePath, db => {
    ensureResearchSchema(db)
    db.exec('BEGIN IMMEDIATE')
    try {
      db.exec('DELETE FROM research_priors; DELETE FROM research_chunks_fts; DELETE FROM research_chunks; DELETE FROM research_sources; DELETE FROM show_research_state;')
      db.exec('COMMIT')
    } catch (error) {
      try { db.exec('ROLLBACK') } catch { /* already rolled back */ }
      throw error
    }
  })
}
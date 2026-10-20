import type { Project } from '@/editor/types'
import { desktop, integrations as desktopIntegrations } from '@/lib/platform'
import type { ContextBankAPI } from '@shared/context-bank'
import {
  CONTEXT_BANK_RESEARCH_CHUNK_TEXT_MAX,
  CONTEXT_BANK_RESEARCH_SEED_CHUNKS_MAX,
  CONTEXT_BANK_RESEARCH_SEED_SOURCES_MAX,
  CONTEXT_BANK_RESEARCH_SOURCE_TEXT_MAX,
  type ContextBankResearchChunk,
  type ContextBankResearchIdentity,
  type ContextBankResearchIdentityCandidate,
  type ContextBankResearchSource,
  type ContextBankResearchState,
} from '@shared/context-bank-research'
import type { AnimeCatalogCandidate, AnimeCatalogResolveResult } from '@shared/anime-catalog'
import type { IntegrationsAPI, WebPage, WebSearchResult } from '@shared/integrations'

export interface AnimeResearchDependencies {
  bank: ContextBankAPI
  integrations: IntegrationsAPI
  now?: () => number
  allowRetry?: boolean
  refreshReady?: boolean
}

export type AnimeResearchSeedResult =
  | { status: 'skipped' }
  | { status: 'ready'; reused?: boolean; identity?: ContextBankResearchIdentity }
  | { status: 'needs-confirmation'; candidates: ContextBankResearchIdentityCandidate[] }
  | { status: 'error'; error: string; retryable: boolean }

const SEARCH_LIMIT = 4
const PAGE_LIMIT = CONTEXT_BANK_RESEARCH_SEED_SOURCES_MAX
const SOURCE_TEXT_LIMIT = CONTEXT_BANK_RESEARCH_SOURCE_TEXT_MAX
const CHUNK_LIMIT = CONTEXT_BANK_RESEARCH_SEED_CHUNKS_MAX
const TRANSIENT_RETRY_DELAYS_MS = [250, 750] as const
const SNIPPET_FALLBACK_NOTICE = 'Search-result snippet only; full page could not be read. Treat as lower-confidence locator evidence.'

type ResearchSleep = (milliseconds: number) => Promise<void>
type BuiltResearchSource = { source: ContextBankResearchSource; chunks: ContextBankResearchChunk[] }
type EpisodeSection = { text: string; episodeNumber?: number }

function researchIdentity(candidate: AnimeCatalogCandidate): ContextBankResearchIdentity {
  return {
    source: candidate.source,
    externalId: candidate.externalId,
    canonicalTitle: candidate.canonicalTitle,
    ...(candidate.year === undefined ? {} : { year: candidate.year }),
    ...(candidate.format === undefined ? {} : { format: candidate.format }),
    ...(candidate.episodes === undefined ? {} : { episodes: candidate.episodes }),
  }
}

function researchCandidate(candidate: AnimeCatalogCandidate): ContextBankResearchIdentityCandidate {
  return {
    ...researchIdentity(candidate),
    aliases: candidate.aliases,
    score: candidate.score,
  }
}

function existingProjectIdentity(project: Project): ContextBankResearchIdentity | undefined {
  const identity = project.animeReview?.identity
  if (!identity) return undefined
  return {
    source: identity.source,
    externalId: identity.externalId,
    canonicalTitle: identity.canonicalTitle,
    ...(identity.year === undefined ? {} : { year: identity.year }),
    ...(identity.format === undefined ? {} : { format: identity.format }),
    ...(identity.episodes === undefined ? {} : { episodes: identity.episodes }),
  }
}

function identityQueries(identity: ContextBankResearchIdentity) {
  const suffix = [identity.year, identity.format].filter(value => value !== undefined && value !== '').join(' ')
  const title = suffix ? `${identity.canonicalTitle} ${suffix}` : identity.canonicalTitle
  return [
    `${title} overview characters`,
    `${title} episode guide`,
    `${title} episode summaries`,
    `${title} plot episodes`,
  ].slice(0, SEARCH_LIMIT)
}

function normalizedUrl(value: string) {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function researchErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
function isTransientResearchError(error: unknown) {
  const message = researchErrorMessage(error).toLowerCase()
  return /\b(?:429|502|503|504)\b/.test(message)
    || /timed?\s*out|timeout|temporar(?:y|ily)|network|fetch failed|econnreset|econnrefused|enetunreach|eai_again/.test(message)
}

async function sleep(milliseconds: number) {
  await new Promise<void>(resolve => setTimeout(resolve, milliseconds))
}

async function withTransientRetry<T>(operation: () => Promise<T>, wait: ResearchSleep): Promise<T> {
  let retryIndex = 0
  while (true) {
    try {
      return await operation()
    } catch (error) {
      if (!isTransientResearchError(error) || retryIndex >= TRANSIENT_RETRY_DELAYS_MS.length) throw error
      await wait(TRANSIENT_RETRY_DELAYS_MS[retryIndex]!)
      retryIndex += 1
    }
  }
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function explicitEpisodeNumber(text: string) {
  const match = /(?:^|\b)(?:episode|ep\.?)[\s#:.-]*(\d{1,5})(?=\b|\s)/i.exec(text)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function leadingEpisodeNumber(text: string, allowBareNumberTitle = false) {
  const labelled = /^[^\p{L}\p{N}]{0,24}(?:episode|ep\.?)[\s#:.-]*(\d{1,5})(?=\b|\s)/iu.exec(text)
  if (labelled) {
    const value = Number(labelled[1])
    return Number.isInteger(value) && value > 0 ? value : undefined
  }
  if (!allowBareNumberTitle) return undefined
  const bare = /^\s*(\d{1,5})\s*["“]/u.exec(text)
  if (!bare) return undefined
  const value = Number(bare[1])
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function splitSerializedEpisodeSections(text: string): EpisodeSection[] | null {
  const markers: Array<{ index: number; episodeNumber: number }> = []
  const pattern = /"EpisodeNumber"\s*:\s*(?:"?(\d{1,5})"?|\{\s*"wt"\s*:\s*"?(\d{1,5})"?\s*\})/g
  for (const match of text.matchAll(pattern)) {
    const index = match.index
    const value = Number(match[1] ?? match[2])
    if (index === undefined || !Number.isInteger(value) || value <= 0) continue
    markers.push({ index, episodeNumber: value })
  }
  if (markers.length < 2) return null

  const sections: EpisodeSection[] = []
  const prefix = text.slice(0, markers[0]!.index).trim()
  if (prefix) sections.push({ text: prefix })

  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index]!
    const end = markers[index + 1]?.index ?? text.length
    const value = text.slice(marker.index, end).trim()
    if (value) sections.push({ text: value, episodeNumber: marker.episodeNumber })
  }

  return sections.length ? sections : null
}

function splitEpisodeSections(text: string): EpisodeSection[] {
  const serializedSections = splitSerializedEpisodeSections(text)
  if (serializedSections) return serializedSections

  const sections: EpisodeSection[] = []
  let lines: string[] = []
  let episodeNumber: number | undefined
  const allowBareNumberTitle = /\bNo\.?\s*Title\s+(?:Original\s+)?(?:release|air)\s+date\b/i.test(text)

  const push = () => {
    const value = lines.join('\n').trim()
    if (value) sections.push({ text: value, ...(episodeNumber === undefined ? {} : { episodeNumber }) })
    lines = []
  }

  for (const line of text.split(/\r?\n/)) {
    const nextEpisodeNumber = leadingEpisodeNumber(line, allowBareNumberTitle)
    if (nextEpisodeNumber !== undefined) {
      push()
      episodeNumber = nextEpisodeNumber
    }
    lines.push(line)
  }
  push()

  return sections.length ? sections : [{ text }]
}

function splitPageIntoChunks(sourceId: string, text: string): Omit<ContextBankResearchChunk, 'id'>[] {
  const chunks: Omit<ContextBankResearchChunk, 'id'>[] = []
  let ordinal = 0

  for (const section of splitEpisodeSections(text)) {
    const paragraphs = section.text
      .split(/\n\s*\n+/)
      .map(part => part.trim())
      .filter(Boolean)

    for (const paragraph of paragraphs) {
      let remaining = paragraph
      while (remaining && chunks.length < CHUNK_LIMIT) {
        const piece = remaining.slice(0, CONTEXT_BANK_RESEARCH_CHUNK_TEXT_MAX).trim()
        if (!piece) break
        const firstLine = piece.split(/\r?\n/, 1)[0]?.trim()
        const firstLineEpisodeNumber = section.episodeNumber ?? (firstLine ? explicitEpisodeNumber(firstLine) : undefined)
        const episodeNumber = section.episodeNumber ?? explicitEpisodeNumber(piece)
        chunks.push({
          sourceId,
          ordinal: ordinal++,
          ...(firstLineEpisodeNumber === undefined ? {} : { heading: `Episode ${firstLineEpisodeNumber}` }),
          text: piece,
          ...(episodeNumber === undefined ? {} : { episodeNumber }),
        })
        remaining = remaining.slice(piece.length).trim()
      }
      if (chunks.length >= CHUNK_LIMIT) break
    }
    if (chunks.length >= CHUNK_LIMIT) break
  }

  return chunks
}

async function collectUniqueSearchResults(integrations: IntegrationsAPI, queries: readonly string[], wait: ResearchSleep) {
  const boundedQueries = queries.slice(0, SEARCH_LIMIT)
  const batches: WebSearchResult[][] = []

  for (const query of boundedQueries) {
    try {
      batches.push(await withTransientRetry(() => integrations.web.search(query, 8), wait))
    } catch {
      batches.push([])
    }
  }

  const found = new Map<string, WebSearchResult>()
  const perQueryReserve = Math.max(1, Math.floor(PAGE_LIMIT / Math.max(1, boundedQueries.length)))

  const add = (result: WebSearchResult) => {
    const url = normalizedUrl(result.url)
    if (!url || found.has(url) || found.size >= PAGE_LIMIT) return false
    found.set(url, { ...result, url })
    return true
  }

  // First pass: reserve a small share of the bounded source pack for every
  // successful query, so a broad character/overview search cannot starve later
  // episode-guide and episode-summary searches that provide locator evidence.
  for (const results of batches) {
    let added = 0
    for (const result of results) {
      if (add(result)) added += 1
      if (added >= perQueryReserve || found.size >= PAGE_LIMIT) break
    }
  }

  // Second pass: fill any unused capacity deterministically from the remaining
  // results without exceeding the existing source bound.
  if (found.size < PAGE_LIMIT) {
    for (const results of batches) {
      for (const result of results) {
        add(result)
        if (found.size >= PAGE_LIMIT) break
      }
      if (found.size >= PAGE_LIMIT) break
    }
  }

  return [...found.values()]
}

async function sourceAndChunks(page: WebPage, retrievedAt: number): Promise<BuiltResearchSource | null> {
  const url = normalizedUrl(page.url)
  const text = String(page.text ?? '').slice(0, SOURCE_TEXT_LIMIT).trim()
  if (!url || !text) return null

  const sourceId = `web-${(await sha256(url)).slice(0, 32)}`
  const source: ContextBankResearchSource = {
    id: sourceId,
    url,
    ...(page.title?.trim() ? { title: page.title.trim().slice(0, 500) } : {}),
    ...(page.site?.trim() ? { site: page.site.trim().slice(0, 256) } : {}),
    retrievedAt,
    contentHash: await sha256(text),
    text,
  }
  const rawChunks = splitPageIntoChunks(sourceId, text)
  const chunks: ContextBankResearchChunk[] = []
  for (const chunk of rawChunks) {
    const id = `chunk-${(await sha256(`${sourceId}:${chunk.ordinal}:${chunk.text}`)).slice(0, 32)}`
    chunks.push({ id, ...chunk })
  }
  return { source, chunks }
}

async function sourceAndChunksFromSearchResult(result: WebSearchResult, retrievedAt: number): Promise<BuiltResearchSource | null> {
  const url = normalizedUrl(result.url)
  const snippet = String(result.snippet ?? '').trim()
  if (!url || !snippet) return null

  const title = String(result.title ?? '').trim()
  const text = [
    SNIPPET_FALLBACK_NOTICE,
    title ? `Result title: ${title}` : '',
    snippet,
  ].filter(Boolean).join('\n').slice(0, SOURCE_TEXT_LIMIT).trim()
  if (!text) return null

  const sourceId = `web-${(await sha256(url)).slice(0, 32)}`
  let site: string | undefined
  try {
    site = new URL(url).hostname
  } catch {
    site = undefined
  }
  const source: ContextBankResearchSource = {
    id: sourceId,
    url,
    ...(title ? { title: title.slice(0, 500) } : {}),
    ...(site ? { site: site.slice(0, 256) } : {}),
    retrievedAt,
    contentHash: await sha256(text),
    text,
  }

  const rawChunks = splitPageIntoChunks(sourceId, text)
  const chunks: ContextBankResearchChunk[] = []
  for (const chunk of rawChunks) {
    const id = `chunk-${(await sha256(`${sourceId}:${chunk.ordinal}:${chunk.text}`)).slice(0, 32)}`
    chunks.push({ id, ...chunk })
  }
  return chunks.length ? { source, chunks } : null
}

function boundedChunksAcrossSources(builds: readonly BuiltResearchSource[]) {
  if (!builds.length) return [] as ContextBankResearchChunk[]

  const chunks: ContextBankResearchChunk[] = []
  const consumed = new Array<number>(builds.length).fill(0)
  const reservePerSource = Math.max(1, Math.floor(CHUNK_LIMIT / builds.length))

  // Give every accepted source a fair first share so a giant overview page
  // cannot consume the entire bank before episode-guide evidence is represented.
  for (let index = 0; index < builds.length && chunks.length < CHUNK_LIMIT; index++) {
    const take = Math.min(reservePerSource, builds[index]!.chunks.length, CHUNK_LIMIT - chunks.length)
    chunks.push(...builds[index]!.chunks.slice(0, take))
    consumed[index] = take
  }

  // Fill unused capacity from remaining chunks in deterministic source order.
  for (let index = 0; index < builds.length && chunks.length < CHUNK_LIMIT; index++) {
    const remaining = builds[index]!.chunks.slice(consumed[index])
    const take = Math.min(remaining.length, CHUNK_LIMIT - chunks.length)
    chunks.push(...remaining.slice(0, take))
  }

  return chunks
}

function state(showQuery: string, status: ContextBankResearchState['status'], updatedAt: number, patch: Partial<ContextBankResearchState> = {}): ContextBankResearchState {
  return { showQuery, status, updatedAt, ...patch }
}

function resolverError(result: Extract<AnimeCatalogResolveResult, { status: 'error' }>, showQuery: string, now: number): ContextBankResearchState {
  return state(showQuery, 'error', now, { error: result.error })
}

/**
 * Seeds one small, reusable web research pack after an anime-review project has
 * a durable path. It never performs web work for unsaved/generic projects and
 * never treats researched episode hints as verified source-media evidence.
 */
export async function seedAnimeResearchForProject(
  project: Project,
  projectPath: string | null,
  dependencies?: AnimeResearchDependencies,
): Promise<AnimeResearchSeedResult> {
  const setup = project.animeReview
  if (!projectPath || !setup?.showQuery) return { status: 'skipped' }

  const resolvedDependencies = dependencies ?? (
    desktop?.contextBank && desktopIntegrations
      ? { bank: desktop.contextBank, integrations: desktopIntegrations }
      : undefined
  )
  if (!resolvedDependencies) return { status: 'skipped' }

  const { bank, integrations } = resolvedDependencies
  const now = resolvedDependencies.now ?? Date.now
  const location = { projectPath, projectId: project.id }
  const existing = await bank.getResearchStatus(location)
  const sameQuery = existing.state?.showQuery === setup.showQuery

  if (sameQuery && existing.state?.status === 'ready' && !resolvedDependencies.refreshReady) {
    return { status: 'ready', reused: true, identity: existing.state.identity }
  }
  if (sameQuery && existing.state?.status === 'error' && !resolvedDependencies.allowRetry) {
    return { status: 'error', error: existing.state.error ?? 'Anime research previously failed', retryable: true }
  }

  let identity = existingProjectIdentity(project)
  if (!identity) {
    const resolved = await integrations.animeCatalog.resolve(setup.showQuery)
    if (resolved.status === 'needs-confirmation') {
      const candidates = resolved.candidates.map(researchCandidate)
      await bank.setResearchState({
        ...location,
        state: state(setup.showQuery, 'needs-confirmation', now(), { candidates }),
      })
      return { status: 'needs-confirmation', candidates }
    }
    if (resolved.status === 'error') {
      await bank.setResearchState({ ...location, state: resolverError(resolved, setup.showQuery, now()) })
      return { status: 'error', error: resolved.error, retryable: resolved.retryable }
    }
    identity = researchIdentity(resolved.selected)
  }

  await bank.setResearchState({
    ...location,
    state: state(setup.showQuery, 'seeding', now(), { identity }),
  })

  try {
    const results = await collectUniqueSearchResults(integrations, identityQueries(identity), sleep)
    let builds: BuiltResearchSource[] = []

    for (const result of results.slice(0, PAGE_LIMIT)) {
      let page: WebPage
      try {
        page = await withTransientRetry(() => integrations.web.read(result.url, SOURCE_TEXT_LIMIT), sleep)
      } catch {
        continue
      }
      const built = await sourceAndChunks(page, now())
      if (!built) continue
      builds.push(built)
      if (builds.length >= PAGE_LIMIT) break
    }

    if (!builds.length) {
      for (const result of results.slice(0, PAGE_LIMIT)) {
        const built = await sourceAndChunksFromSearchResult(result, now())
        if (!built) continue
        builds.push(built)
        if (builds.length >= PAGE_LIMIT) break
      }
    }

    if (!builds.length) throw new Error('No usable research pages or search-result snippets were found')

    const sources = builds.map(built => built.source)
    const chunks = boundedChunksAcrossSources(builds)
    const ready = state(setup.showQuery, 'ready', now(), { identity })
    await bank.replaceResearchSeed({ ...location, state: ready, sources, chunks })
    return { status: 'ready', identity }
  } catch (error) {
    const message = researchErrorMessage(error)
    await bank.setResearchState({
      ...location,
      state: state(setup.showQuery, 'error', now(), { identity, error: message.slice(0, 2_000) }),
    })
    return { status: 'error', error: message, retryable: true }
  }
}
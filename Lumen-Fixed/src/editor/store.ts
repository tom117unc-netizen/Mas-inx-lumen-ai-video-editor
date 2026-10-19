/**
 * Project store: the document, plus undo/redo built on Immer patches.
 * All user/AI editing mutations go through `dispatch(command, input)`; small
 * system-owned metadata writes use explicit internal helpers below so they are
 * never accidentally exposed as agent commands.
 */
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer'
import { create } from 'zustand'
import { commands, CommandError, type AnyCommand, type CommandInput, type CommandName } from './commands'
import { DEFAULT_TEXT, DEFAULT_TRANSFORM } from './defaults'
import { createEmptyProject } from './new-project'
import { verifyApprovedProposal, type ReviewProposal } from './anime-review-approval'
import { sanitizeAnimeReviewSetup, type AnimeReviewIdentity } from './anime-review-project'
import { normalizeProject } from './ops'
import { applyMarkerChanges, type MarkerChange } from './anime-timeline-operations'
import type { Clip, Project } from './types'

enablePatches()

export type ActionSource = 'user' | 'ai'

export interface HistoryEntry {
  id: number
  label: string
  source: ActionSource
  patches: Patch[]
  inverse: Patch[]
  /** Consecutive dispatches with the same key merge into one step (slider drags). */
  key?: string
  at: number
}

export type CommittedEditKind = 'dispatch' | 'transaction' | 'undo' | 'redo' | 'load'

/** One durable editor boundary the Context Bank can mirror without observing half-finished edits. */
export interface CommittedEditEvent {
  kind: CommittedEditKind
  revision: number
  historyId?: number
  label?: string
  source?: ActionSource
  at: number
}

export interface DispatchOptions {
  source?: ActionSource
  label?: string
  coalesce?: string
  /**
   * false: apply without an undo step and without marking the project edited —
   * for data the editor derives in the background (waveforms, media metadata).
   */
  history?: false
}

export type DispatchResult = { ok: true; result: unknown } | { ok: false; error: string }

interface EditorState {
  project: Project
  past: HistoryEntry[]
  future: HistoryEntry[]
  /** Increments on every user-visible edit (undo/redo included) — the "unsaved changes" signal. */
  version: number
  dispatch: <N extends CommandName>(name: N, input: CommandInput<N>, opts?: DispatchOptions) => DispatchResult
  /** Groups every dispatch inside `fn` into a single undo step. */
  transaction: (label: string, source: ActionSource, fn: () => void) => HistoryEntry | null
  approveAiProposal: (proposal: ReviewProposal) => DispatchResult
  applyAiMarkerChanges: (changes: readonly MarkerChange[]) => DispatchResult
  undo: () => HistoryEntry | undefined
  redo: () => HistoryEntry | undefined
  /** Replaces the document (open / new project) and clears history. */
  loadProject: (project: Project) => void
}

const HISTORY_LIMIT = 300
const COALESCE_MS = 1200

let openTransaction: HistoryEntry | null = null
let nextEntryId = 1
const committedListeners = new Set<(event: CommittedEditEvent) => void>()

function emitCommitted(kind: CommittedEditKind, revision: number, entry?: HistoryEntry) {
  const event: CommittedEditEvent = {
    kind,
    revision,
    ...(entry ? { historyId: entry.id, label: entry.label, source: entry.source } : {}),
    at: Date.now(),
  }
  for (const listener of committedListeners) {
    try {
      listener(event)
    } catch (error) {
      console.warn('Committed edit listener failed', error)
    }
  }
}

/** Subscribe to successful durable edit boundaries. Background-derived changes are intentionally omitted. */
export function subscribeCommittedEdits(listener: (event: CommittedEditEvent) => void) {
  committedListeners.add(listener)
  return () => void committedListeners.delete(listener)
}

/** Fills in fields added since a project was saved, so older projects keep working. */
export function migrateProject(p: Project): Project {
  p.assets ??= {}
  p.clips ??= {}
  p.markers ??= []
  const fill = (clips: Record<string, Clip>) => {
    for (const c of Object.values(clips)) {
      c.transform = { ...DEFAULT_TRANSFORM, ...c.transform }
      if (c.kind === 'text' && c.text) c.text = { ...DEFAULT_TEXT, ...c.text }
    }
  }
  fill(p.clips)
  for (const seq of Object.values(p.sequences ?? {})) {
    seq.clips ??= {}
    seq.markers ??= []
    seq.tracks ??= []
    fill(seq.clips)
  }
  return p
}

export const useEditor = create<EditorState>()((set, get) => ({
  project: createEmptyProject(),
  past: [],
  future: [],
  version: 0,

  dispatch(name, input, opts = {}) {
    const def = commands[name] as unknown as AnyCommand
    const parsed = def.input.safeParse(input)
    if (!parsed.success) {
      const error = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      console.warn(`[${name}] invalid input`, error)
      return { ok: false, error }
    }

    let result: unknown
    let next: Project
    let patches: Patch[]
    let inverse: Patch[]
    const before = get().project
    try {
      ;[next, patches, inverse] = produceWithPatches(before, (draft) => {
        result = def.run(draft, parsed.data)
        normalizeProject(draft, before)
      })
    } catch (err) {
      if (err instanceof CommandError) return { ok: false, error: err.message }
      throw err
    }
    if (!patches.length) return { ok: true, result }

    if (opts.history === false) {
      set({ project: next })
      return { ok: true, result }
    }

    const version = get().version + 1
    if (openTransaction) {
      openTransaction.patches.push(...patches)
      openTransaction.inverse.unshift(...inverse)
      set({ project: next, version })
      return { ok: true, result }
    }

    const now = performance.now()
    const past = get().past
    const last = past[past.length - 1]
    if (opts.coalesce && last?.key === opts.coalesce && now - last.at < COALESCE_MS) {
      const merged: HistoryEntry = { ...last, patches: [...last.patches, ...patches], inverse: [...inverse, ...last.inverse], at: now }
      set({ project: next, past: [...past.slice(0, -1), merged], future: [], version })
      emitCommitted('dispatch', version, merged)
    } else {
      const entry: HistoryEntry = {
        id: nextEntryId++,
        label: opts.label ?? def.title(parsed.data, get().project),
        source: opts.source ?? 'user',
        patches,
        inverse,
        key: opts.coalesce,
        at: now,
      }
      set({ project: next, past: [...past, entry].slice(-HISTORY_LIMIT), future: [], version })
      emitCommitted('dispatch', version, entry)
    }
    return { ok: true, result }
  },

  transaction(label, source, fn) {
    if (openTransaction) {
      fn()
      return null
    }
    beginTransaction(label, source)
    try {
      fn()
    } catch (err) {
      endTransaction()
      throw err
    }
    return endTransaction()
  },

  approveAiProposal(proposal) {
    if (openTransaction) return { ok: false, error: 'Finish the current edit transaction first' }
    const before = get().project
    let next: Project
    let patches: Patch[]
    let inverse: Patch[]
    try {
      const approved = verifyApprovedProposal(before, proposal)
      ;[next, patches, inverse] = produceWithPatches(before, (draft) => {
        for (const edit of proposal.patch.edits) {
          const openId = draft.sequence?.id ?? 'main'
          const dest = edit.sequenceId === openId ? draft : draft.sequences?.[edit.sequenceId]
          const source = edit.sequenceId === openId ? approved : approved.sequences?.[edit.sequenceId]
          if (!dest || !source) throw new Error('Sequence missing during commit')
          if (edit.op === 'setTrack') {
            const index = dest.tracks.findIndex(t => t.id === edit.trackId)
            const updated = source.tracks.find(t => t.id === edit.trackId)
            if (index < 0 || !updated) throw new Error('Track missing during commit')
            dest.tracks[index] = structuredClone(updated)
          } else {
            const updated = source.clips[edit.clipId]
            if (!updated) throw new Error('Clip missing during commit')
            dest.clips[edit.clipId] = structuredClone(updated)
          }
        }
        normalizeProject(draft, before)
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (!patches.length) return { ok: true, result: { changes: 0 } }
    const entry: HistoryEntry = {
      id: nextEntryId++, label: 'Apply approved anime review edits', source: 'ai',
      patches, inverse, at: performance.now(),
    }
    const version = get().version + 1
    set(s => ({ project: next, past: [...s.past, entry].slice(-HISTORY_LIMIT), future: [], version }))
    emitCommitted('dispatch', version, entry)
    return { ok: true, result: { changes: proposal.changes.length } }
  },
  applyAiMarkerChanges(changes) {
    if (openTransaction) return { ok: false, error: 'Finish the current edit transaction first' }
    const before = get().project
    let next: Project
    let patches: Patch[]
    let inverse: Patch[]
    try {
      // Validate the entire batch before committing anything.
      const verified = applyMarkerChanges(before, changes)
      ;[next, patches, inverse] = produceWithPatches(before, draft => {
        draft.markers = verified.markers
        for (const [id, seq] of Object.entries(verified.sequences ?? {})) {
          if (draft.sequences?.[id]) draft.sequences[id].markers = seq.markers
        }
      })
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (!patches.length) return { ok: true, result: { changes: 0 } }
    const entry: HistoryEntry = {
      id: nextEntryId++, label: 'AI marker edits', source: 'ai',
      patches, inverse, at: performance.now(),
    }
    const version = get().version + 1
    set(state => ({
      project: next, past: [...state.past, entry].slice(-HISTORY_LIMIT),
      future: [], version,
    }))
    emitCommitted('dispatch', version, entry)
    return { ok: true, result: { changes: changes.length } }
  },
  undo() {
    const { past, future, project, version } = get()
    const entry = past[past.length - 1]
    if (!entry) return undefined
    const nextVersion = version + 1
    set({ project: applyPatches(project, entry.inverse), past: past.slice(0, -1), future: [entry, ...future], version: nextVersion })
    emitCommitted('undo', nextVersion, entry)
    return entry
  },

  redo() {
    const { past, future, project, version } = get()
    const entry = future[0]
    if (!entry) return undefined
    const nextVersion = version + 1
    set({ project: applyPatches(project, entry.patches), past: [...past, entry], future: future.slice(1), version: nextVersion })
    emitCommitted('redo', nextVersion, entry)
    return entry
  },

  loadProject(project) {
    normalizeProject(project)
    const version = get().version + 1
    set({ project, past: [], future: [], version })
    emitCommitted('load', version)
  },
}))

/**
 * Opens a history step that collects every dispatch until `endTransaction()` —
 * used by the AI agent, whose multi-step edits span several animation frames
 * but should undo as one.
 */
export function beginTransaction(label: string, source: ActionSource) {
  if (openTransaction) return null
  openTransaction = { id: nextEntryId++, label, source, patches: [], inverse: [], at: performance.now() }
  return openTransaction
}

export function endTransaction(): HistoryEntry | null {
  const entry = openTransaction
  openTransaction = null
  if (!entry || !entry.patches.length) return null
  useEditor.setState((s) => ({ past: [...s.past, entry].slice(-HISTORY_LIMIT), future: [] }))
  emitCommitted('transaction', useEditor.getState().version, entry)
  return entry
}

/** A point inside the open transaction that a failed multi-step edit can roll back to. */
export interface Savepoint {
  patches: number
  inverse: number
  version: number
}

export function savepoint(): Savepoint | null {
  const t = openTransaction
  return t ? { patches: t.patches.length, inverse: t.inverse.length, version: useEditor.getState().version } : null
}

/**
 * Reverts everything dispatched since `mark` and forgets it, so an all-or-nothing
 * edit that fails part-way leaves the project — and the undo history — untouched.
 */
export function rollbackTo(mark: Savepoint) {
  const t = openTransaction
  if (!t) return
  const added = t.inverse.length - mark.inverse
  if (added <= 0) return
  // Each dispatch put its inverse at the front, so the newest changes come first.
  const undo = t.inverse.splice(0, added)
  t.patches.length = mark.patches
  useEditor.setState((s) => ({ project: applyPatches(s.project, undo), version: mark.version }))
}

/** Undo a specific step, only if nothing happened after it. */
export function undoEntry(id: number) {
  const { past, undo } = useEditor.getState()
  if (past[past.length - 1]?.id !== id) return false
  undo()
  return true
}

function sameAnimeReviewIdentity(a: AnimeReviewIdentity | undefined, b: AnimeReviewIdentity) {
  return Boolean(a
    && a.source === b.source
    && a.externalId === b.externalId
    && a.canonicalTitle === b.canonicalTitle
    && a.year === b.year
    && a.format === b.format
    && a.episodes === b.episodes)
}

/**
 * Persists system-confirmed anime identity into the canonical project without
 * exposing an editor command the AI can call. This intentionally marks the
 * document dirty but creates no undo step: it is durable project metadata, not
 * a creative timeline edit.
 */
export function recordAnimeReviewIdentity(projectId: string, showQuery: string, identity: AnimeReviewIdentity) {
  const state = useEditor.getState()
  const before = state.project
  if (before.id !== projectId || before.animeReview?.showQuery !== showQuery) return false

  const setup = sanitizeAnimeReviewSetup({ ...before.animeReview, identity })
  if (!setup?.identity || sameAnimeReviewIdentity(before.animeReview.identity, setup.identity)) return false

  const [next, patches] = produceWithPatches(before, draft => {
    draft.animeReview = structuredClone(setup)
    normalizeProject(draft, before)
  })
  if (!patches.length) return false

  const version = state.version + 1
  useEditor.setState({ project: next, version })
  emitCommitted('dispatch', version)
  return true
}

/** Shorthand for non-React callers (keyboard shortcuts, AI agent, menus). */
export const dispatch: EditorState['dispatch'] = (name, input, opts) => useEditor.getState().dispatch(name, input, opts)
export const getProject = () => useEditor.getState().project

/** Deterministic, non-ripple marker operations and timeline inventory for Lumen 1.4.0.
 * These functions are pure. Callers must commit through the editor's undoable store.
 */
import type { Project, Marker, MarkerColor, Clip } from './types'

export type TimelineTarget = { sequenceId?: string }
export type MarkerChange =
  | ({ op: 'add'; id: string; frame: number; label: string; color?: MarkerColor } & TimelineTarget)
  | ({ op: 'update'; id: string; frame?: number; label?: string; color?: MarkerColor } & TimelineTarget)
  | ({ op: 'remove'; id: string } & TimelineTarget)

function timeline(project: Project, sequenceId?: string) {
  const openId = project.sequence?.id ?? 'main'
  if (!sequenceId || sequenceId === openId) return project
  const found = project.sequences?.[sequenceId]
  if (!found) throw new Error(`Timeline not found: ${sequenceId}`)
  return found
}

export function listTimelineMarkers(project: Project, sequenceId?: string): Marker[] {
  return structuredClone(timeline(project, sequenceId).markers ?? []).sort((a, b) => a.frame - b.frame)
}

function validColor(color: string): color is MarkerColor {
  return ['lime', 'violet', 'pink', 'amber', 'emerald', 'sky'].includes(color)
}

/** Atomic marker batch. Never moves, trims, or retimes a clip. */
export function applyMarkerChanges(project: Project, changes: readonly MarkerChange[]): Project {
  const next = structuredClone(project)
  for (const change of changes) {
    const seq = timeline(next, change.sequenceId)
    seq.markers ??= []
    const index = seq.markers.findIndex(m => m.id === change.id)
    if (change.op === 'add') {
      if (index !== -1) throw new Error(`Duplicate marker: ${change.id}`)
      if (!Number.isSafeInteger(change.frame) || change.frame < 0) throw new Error('Invalid marker frame')
      if (!change.id.trim() || !change.label.trim()) throw new Error('Marker id and label required')
      if (change.color !== undefined && !validColor(change.color)) throw new Error('Invalid marker color')
      seq.markers.push({ id: change.id, frame: change.frame, label: change.label, color: change.color ?? 'amber' })
    } else {
      if (index === -1) throw new Error(`Marker not found: ${change.id}`)
      if (change.op === 'remove') seq.markers.splice(index, 1)
      else {
        const old = seq.markers[index]
        if (change.frame !== undefined && (!Number.isSafeInteger(change.frame) || change.frame < 0)) throw new Error('Invalid marker frame')
        if (change.label !== undefined && !change.label.trim()) throw new Error('Marker label required')
        if (change.color !== undefined && !validColor(change.color)) throw new Error('Invalid marker color')
        seq.markers[index] = { ...old, ...(change.frame === undefined ? {} : { frame: change.frame }), ...(change.label === undefined ? {} : { label: change.label }), ...(change.color === undefined ? {} : { color: change.color }) }
      }
    }
    seq.markers.sort((a, b) => a.frame - b.frame)
  }
  return next
}

export interface TimelineInventory {
  sequenceId: string
  name: string
  markers: Marker[]
  clips: Array<{ id: string; trackId: string; kind: Clip['kind']; start: number; duration: number; nestedSequenceId?: string }>
}

/** Discover open and stored timelines without switching the editor selection. */
export function inspectTimelines(project: Project): TimelineInventory[] {
  const sources = [
    { id: project.sequence?.id ?? 'main', name: project.sequence?.name ?? 'Main', clips: project.clips, markers: project.markers },
    ...Object.values(project.sequences ?? {}).map(s => ({ id: s.id, name: s.name, clips: s.clips, markers: s.markers })),
  ]
  return sources.map(s => ({
    sequenceId: s.id,
    name: s.name,
    markers: structuredClone(s.markers ?? []),
    clips: Object.values(s.clips ?? {}).map(c => ({
      id: c.id, trackId: c.trackId, kind: c.kind, start: c.start, duration: c.duration,
      ...(c.sequenceId ? { nestedSequenceId: c.sequenceId } : {}),
    })),
  }))
}

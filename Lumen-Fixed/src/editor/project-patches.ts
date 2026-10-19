/** Validated, atomic AI edits. Place in src/editor/. Does not mutate live editor state. */
import type { Project, Clip, Track } from './types'
import { createAiManifest } from './project-manifest'

export type AiEdit =
  | { op: 'move'; sequenceId: string; clipId: string; start: number; expectedStart?: number }
  | { op: 'trim'; sequenceId: string; clipId: string; start: number; duration: number; inPoint: number; expectedStart?: number }
  | { op: 'setText'; sequenceId: string; clipId: string; content: string }
  | { op: 'setAsset'; sequenceId: string; clipId: string; assetId: string }
  | { op: 'setTransform'; sequenceId: string; clipId: string; transform: Partial<Clip['transform']> }
  | { op: 'setAudio'; sequenceId: string; clipId: string; audio: Partial<Clip['audio']> }
  | { op: 'setTrack'; sequenceId: string; trackId: string; changes: Partial<Pick<Track, 'muted' | 'hidden' | 'solo'>> }

export interface AiPatch { format: 'lumen-ai-patch'; version: 1; projectId: string; edits: AiEdit[] }
export interface PatchResult { project: Project; changes: string[]; warnings: string[] }

function frame(n: number, name: string, allowZero = true) {
  if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1)) throw new Error(`${name} must be a ${allowZero ? 'nonnegative' : 'positive'} integer frame count`)
}
function finite(n: number, name: string) { if (!Number.isFinite(n)) throw new Error(`${name} must be finite`) }

export function applyAiPatch(original: Project, patch: AiPatch): PatchResult {
  if (patch.format !== 'lumen-ai-patch' || patch.version !== 1) throw new Error('Unsupported patch format')
  if (patch.projectId !== original.id) throw new Error('Patch belongs to a different project')
  if (!Array.isArray(patch.edits) || patch.edits.length > 5000) throw new Error('Invalid edit count')
  const project = structuredClone(original)
  const changes: string[] = []
  for (const edit of patch.edits) {
    const currentId = project.sequence?.id ?? 'main'
    const seq = edit.sequenceId === currentId ? project : project.sequences?.[edit.sequenceId]
    if (!seq) throw new Error(`Unknown sequence: ${edit.sequenceId}`)
    if (edit.op === 'setTrack') {
      const track = seq.tracks.find(t => t.id === edit.trackId)
      if (!track) throw new Error(`Unknown track: ${edit.trackId}`)
      if (track.locked) throw new Error(`Track locked: ${edit.trackId}`)
      if (!edit.changes || typeof edit.changes !== 'object' || Array.isArray(edit.changes)) throw new Error('Invalid track changes')
      for (const [key, value] of Object.entries(edit.changes)) {
        if (!['muted', 'hidden', 'solo'].includes(key) || typeof value !== 'boolean') throw new Error(`Invalid track property: ${key}`)
      }
      Object.assign(track, edit.changes)
      changes.push(`${edit.sequenceId}/track/${edit.trackId}`)
      continue
    }
    const clip = seq.clips[edit.clipId]
    if (!clip) throw new Error(`Unknown clip: ${edit.clipId}`)
    if (seq.tracks.find(t => t.id === clip.trackId)?.locked) throw new Error(`Clip on locked track: ${clip.id}`)
    if ('expectedStart' in edit && edit.expectedStart !== undefined && clip.start !== edit.expectedStart) throw new Error(`Stale start for clip ${clip.id}`)
    switch (edit.op) {
      case 'move': frame(edit.start, 'start'); clip.start = edit.start; break
      case 'trim':
        frame(edit.start, 'start'); frame(edit.duration, 'duration', false); frame(edit.inPoint, 'inPoint')
        clip.start = edit.start; clip.duration = edit.duration; clip.inPoint = edit.inPoint; break
      case 'setText':
        if (clip.kind !== 'text' || !clip.text) throw new Error(`Clip ${clip.id} is not a text clip`)
        if (typeof edit.content !== 'string') throw new Error('Text content must be a string')
        clip.text.content = edit.content; break
      case 'setAsset':
        if (typeof edit.assetId !== 'string' || !edit.assetId) throw new Error('Asset ID required')
        if (!project.assets[edit.assetId]) throw new Error(`Unknown asset: ${edit.assetId}`)
        if (!clip.assetId) throw new Error(`Clip ${clip.id} does not reference a replaceable media asset`)
        clip.assetId = edit.assetId; break
      case 'setTransform':
        if (!edit.transform || typeof edit.transform !== 'object' || Array.isArray(edit.transform)) throw new Error('Invalid transform')
        for (const [key, value] of Object.entries(edit.transform)) {
          if (!['x','y','z','scale','rotation','opacity','rotateX','rotateY'].includes(key) || typeof value !== 'number') throw new Error(`Invalid transform property: ${key}`)
          finite(value, key)
          if (key === 'opacity' && (value < 0 || value > 1)) throw new Error('Opacity must be 0..1')
          if (key === 'scale' && value <= 0) throw new Error('Scale must be positive')
        }
        Object.assign(clip.transform, edit.transform); break
      case 'setAudio':
        if (!edit.audio || typeof edit.audio !== 'object' || Array.isArray(edit.audio)) throw new Error('Invalid audio')
        for (const [key, value] of Object.entries(edit.audio)) {
          if (!['volume','fadeIn','fadeOut','enhance','denoise','detached'].includes(key)) throw new Error(`Invalid audio property: ${key}`)
          if (['volume','fadeIn','fadeOut'].includes(key)) {
            if (typeof value !== 'number') throw new Error(`Invalid ${key}`)
            if (key === 'volume') finite(value, key); else frame(value, key)
          } else if (typeof value !== 'boolean') throw new Error(`Invalid ${key}`)
        }
        Object.assign(clip.audio, edit.audio); break
      default: throw new Error('Unknown edit operation')
    }
    changes.push(`${edit.sequenceId}/clip/${clip.id}/${edit.op}`)
  }
  return { project, changes, warnings: createAiManifest(project).inventory.warnings }
}

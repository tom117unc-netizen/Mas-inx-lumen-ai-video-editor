import {
  CONTEXT_BANK_MIRROR_FORMAT,
  CONTEXT_BANK_MIRROR_VERSION,
  type ContextBankAssetMirror,
  type ContextBankClipMirror,
  type ContextBankMarkerMirror,
  type ContextBankMirror,
  type ContextBankSequenceMirror,
} from '@shared/context-bank'
import type { Clip, Marker, Project, Sequence } from './types'

function clipsFor(sequenceId: string, clips: Record<string, Clip>): ContextBankClipMirror[] {
  return Object.values(clips)
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .map(clip => ({
      sequenceId,
      clipId: clip.id,
      trackId: clip.trackId,
      name: clip.name,
      kind: clip.kind,
      start: clip.start,
      duration: clip.duration,
      ...(clip.assetId ? { assetId: clip.assetId } : {}),
      inPoint: clip.inPoint,
      speed: clip.speed,
      reverse: clip.reverse,
      freeze: Boolean(clip.freeze),
      hasSpeedRamp: Boolean(clip.keyframes.speed?.length),
      ...(clip.sequenceId ? { nestedSequenceId: clip.sequenceId } : {}),
    }))
}

function markersFor(sequenceId: string, markers: Marker[]): ContextBankMarkerMirror[] {
  return [...markers]
    .sort((a, b) => a.frame - b.frame || a.id.localeCompare(b.id))
    .map(marker => ({
      sequenceId,
      markerId: marker.id,
      frame: marker.frame,
      label: marker.label,
      color: marker.color,
    }))
}

function storedSequence(sequence: Sequence): ContextBankSequenceMirror {
  return {
    id: sequence.id,
    name: sequence.name,
    fps: sequence.settings.fps,
    clips: clipsFor(sequence.id, sequence.clips),
    markers: markersFor(sequence.id, sequence.markers),
  }
}

/**
 * Small, deterministic representation of canonical editor state for the Context Bank.
 * Heavy analysis arrays and runtime URLs deliberately never cross this boundary.
 */
export function createContextBankMirror(project: Project, revision: number): ContextBankMirror {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Context Bank revision must be a non-negative integer')

  const assets: ContextBankAssetMirror[] = Object.values(project.assets)
    .filter(asset => asset.source.type === 'file' && typeof asset.source.path === 'string' && asset.source.path.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(asset => {
      const source = asset.source.type === 'file' ? asset.source : neverSource()
      return {
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        ...(asset.duration === undefined ? {} : { duration: asset.duration }),
        ...(asset.width === undefined ? {} : { width: asset.width }),
        ...(asset.height === undefined ? {} : { height: asset.height }),
        ...(asset.fps === undefined ? {} : { fps: asset.fps }),
        ...(asset.hasAudio === undefined ? {} : { hasAudio: asset.hasAudio }),
        path: source.path!,
        fileName: source.fileName,
        mime: source.mime,
        size: source.size,
        ...(source.mtime === undefined ? {} : { mtime: source.mtime }),
        missing: Boolean(source.missing),
      }
    })

  const openId = project.sequence?.id ?? 'main'
  const open: ContextBankSequenceMirror = {
    id: openId,
    name: project.sequence?.name ?? 'Main',
    fps: project.settings.fps,
    clips: clipsFor(openId, project.clips),
    markers: markersFor(openId, project.markers),
  }
  const stored = Object.values(project.sequences ?? {})
    .filter(sequence => sequence.id !== openId)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(storedSequence)

  return {
    format: CONTEXT_BANK_MIRROR_FORMAT,
    version: CONTEXT_BANK_MIRROR_VERSION,
    projectId: project.id,
    projectName: project.name,
    revision,
    assets,
    sequences: [open, ...stored],
  }
}

function neverSource(): never {
  throw new Error('Expected a file-backed asset')
}

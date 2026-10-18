/** Lossless, read-only AI export of a Lumen project. Place in src/editor/. */
import type { Project, Clip } from './types'

export interface SequenceInventory {
  id: string; name: string; fps: number; tracks: number; clips: number;
  durationFrames: number; effects: Record<string, number>; transitions: number;
  keyframes: number; groups: Record<string, string[]>; nestedSequenceIds: string[]
}
export interface LumenAiManifest {
  format: 'lumen-ai-manifest'; version: 2; exportedAt: string
  project: Project
  inventory: { sequences: SequenceInventory[]; assets: number; mediaPaths: string[];
    missingAssetIds: string[]; warnings: string[] }
}

const entries = <T>(record: Record<string, T> | undefined): T[] => Object.values(record ?? {})

export function createAiManifest(project: Project): LumenAiManifest {
  const p = structuredClone(project)
  const sequences = [{ id: p.sequence?.id ?? 'main', name: p.sequence?.name ?? 'Main',
    settings: p.settings, tracks: p.tracks, clips: p.clips },
    ...entries(p.sequences).map(s => ({ id: s.id, name: s.name, settings: s.settings,
      tracks: s.tracks, clips: s.clips }))]
  const warnings: string[] = []
  const knownIds = new Set(sequences.map(s => s.id))
  const inventory = sequences.map(s => {
    const clips = entries(s.clips)
    const groups: Record<string, string[]> = {}
    const effects: Record<string, number> = {}
    const nestedSequenceIds = new Set<string>()
    let transitions = 0, keyframes = 0, durationFrames = 0
    const trackIds = new Set(s.tracks.map(t => t.id))
    for (const c of clips) {
      durationFrames = Math.max(durationFrames, c.start + c.duration)
      if (c.groupId) (groups[c.groupId] ??= []).push(c.id)
      if (c.sequenceId) {
        nestedSequenceIds.add(c.sequenceId)
        if (!knownIds.has(c.sequenceId)) warnings.push(`Sequence ${s.id}: clip ${c.id} refers to missing nested sequence ${c.sequenceId}`)
      }
      if (!trackIds.has(c.trackId)) warnings.push(`Sequence ${s.id}: clip ${c.id} refers to missing track ${c.trackId}`)
      if (c.assetId && !p.assets[c.assetId]) warnings.push(`Sequence ${s.id}: clip ${c.id} refers to missing asset ${c.assetId}`)
      if (c.transitionIn) transitions++
      for (const effect of c.effects ?? []) effects[effect.kind] = (effects[effect.kind] ?? 0) + 1
      for (const frames of Object.values(c.keyframes ?? {})) keyframes += frames?.length ?? 0
    }
    return { id: s.id, name: s.name, fps: s.settings.fps, tracks: s.tracks.length,
      clips: clips.length, durationFrames, effects, transitions, keyframes,
      groups, nestedSequenceIds: [...nestedSequenceIds] }
  })
  const assets = entries(p.assets)
  const mediaPaths = [...new Set(assets.flatMap(a => {
    const source = a.source
    return source.type === 'file' ? [source.path, source.relPath] : [source.dir, source.relDir]
  }).filter((x): x is string => typeof x === 'string'))]
  return { format: 'lumen-ai-manifest', version: 2, exportedAt: new Date().toISOString(),
    project: p, inventory: { sequences: inventory, assets: assets.length, mediaPaths,
      missingAssetIds: assets.filter(a => a.source.missing).map(a => a.id), warnings } }
}

export function downloadAiManifest(project: Project): void {
  const blob = new Blob([JSON.stringify(createAiManifest(project), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = `${project.name.replace(/[^a-z0-9_-]+/gi, '_') || 'untitled'}.ai-manifest.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    // Defer revocation until the browser has started the download.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

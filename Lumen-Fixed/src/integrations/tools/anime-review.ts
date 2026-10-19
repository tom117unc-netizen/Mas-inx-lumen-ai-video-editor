/** Anime review AI tools: reliable IDs, nested timeline inventory and bounded project memory. */
import { previewAnimeAiPatch } from '@/editor/anime-review-approval'
import { inspectTimelines, listTimelineMarkers } from '@/editor/anime-timeline-operations'
import { PEAKS_PER_SECOND } from '@/editor/defaults'
import { materializeMouthSyncClips, planMouthSync, planSpriteVersionReplacement } from '@/editor/anime-pngtuber-sync'
import { getProject, useEditor } from '@/editor/store'
import { uid } from '@/lib/id'
import { desktop } from '@/lib/platform'
import { flushContextBankWrites } from '@/project/context-bank-runtime'
import { useSession } from '@/project/session'
import { CONTEXT_BANK_ANALYSIS_TOOLS } from './context-bank-analysis'
import { makeContextBankQuery } from './context-bank-query'
import { CONTEXT_BANK_RESEARCH_TOOLS } from './context-bank-research'
import { SOURCE_SCENE_SEARCH_TOOL } from './source-scene-search'
import { ANIME_ROUGH_CUT_TOOL } from './anime-rough-cut'
import { list, obj, str, num, int, oneOf, type AgentTool } from './kit'

const MAX_PNGTUBER_PREVIEW_INTERVALS = 1_200
const MAX_PNGTUBER_REPLACEMENTS = 5_000

type SpriteReplacementArgs = Record<string, unknown>
type MouthSyncArgs = Record<string, unknown>

function buildSpriteReplacementPlan(project: ReturnType<typeof getProject>, args: SpriteReplacementArgs) {
  if (!Array.isArray(args.replacements) || !args.replacements.length) throw new Error('At least one explicit sprite replacement is required.')
  const replacements: Record<string, string> = {}
  for (const raw of args.replacements) {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid sprite replacement entry.')
    const entry = raw as Record<string, unknown>
    const from = typeof entry.from_asset_id === 'string' ? entry.from_asset_id : ''
    const to = typeof entry.to_asset_id === 'string' ? entry.to_asset_id : ''
    if (!from || !to) throw new Error('Each sprite replacement needs from_asset_id and to_asset_id.')
    if (!project.assets[from]) throw new Error(`Unknown source sprite asset ID: ${from}`)
    if (!project.assets[to]) throw new Error(`Unknown replacement sprite asset ID: ${to}`)
    replacements[from] = to
  }

  const allow = Array.isArray(args.clip_ids)
    ? new Set(args.clip_ids.filter((id): id is string => typeof id === 'string'))
    : null
  if (allow) {
    for (const id of allow) if (!project.clips[id]) throw new Error(`Unknown clip ID: ${id}`)
  }
  const clips = Object.values(project.clips).filter(clip => !allow || allow.has(clip.id))
  const operations = planSpriteVersionReplacement(clips, replacements)
  if (operations.length > MAX_PNGTUBER_REPLACEMENTS) {
    throw new Error(`Sprite replacement would touch ${operations.length} clips; narrow clip_ids below the ${MAX_PNGTUBER_REPLACEMENTS} operation safety cap.`)
  }
  return operations
}

function buildMouthIntervals(project: ReturnType<typeof getProject>, args: MouthSyncArgs) {
  const clipId = String(args.clip_id ?? '')
  const clip = project.clips[clipId]
  if (!clip) throw new Error(`Unknown clip ID: ${clipId}`)
  if (!clip.assetId) throw new Error(`Clip ${clipId} has no source media asset.`)
  if (clip.reverse) throw new Error('PNGTuber mouth planning does not support reversed narration clips.')
  if (clip.keyframes.speed?.length) throw new Error('PNGTuber mouth planning does not support narration speed ramps yet; use a constant-speed clip.')
  const asset = project.assets[clip.assetId]
  if (!asset) throw new Error(`Clip ${clipId} references missing asset ${clip.assetId}.`)
  if (!asset.peaks?.length) throw new Error(`Asset ${asset.name} has no cached waveform peaks yet. Re-import or analyse the narration media first.`)
  const intervals = planMouthSync(
    { peaks: asset.peaks, peaksPerSecond: PEAKS_PER_SECOND },
    { timelineStartFrame: clip.start, durationFrames: clip.duration, sourceInSeconds: clip.inPoint / project.settings.fps, speed: clip.speed },
    {
      fps: project.settings.fps,
      ...(typeof args.open_threshold === 'number' ? { openThreshold: args.open_threshold } : {}),
      ...(typeof args.close_threshold === 'number' ? { closeThreshold: args.close_threshold } : {}),
      ...(typeof args.smoothing_ms === 'number' ? { smoothingMs: args.smoothing_ms } : {}),
      ...(typeof args.minimum_hold_frames === 'number' ? { minimumHoldFrames: args.minimum_hold_frames } : {}),
      ...(typeof args.sync_offset_ms === 'number' ? { offsetMs: args.sync_offset_ms } : {}),
    },
  )
  return { clipId, clip, asset, intervals }
}

const mouthSyncTuningSchema = () => ({
  open_threshold: num('Optional mouth-open threshold, 0–1. Default 0.12.', { minimum: 0, maximum: 1 }),
  close_threshold: num('Optional mouth-close threshold, lower than open threshold. Default 0.075.', { minimum: 0, maximum: 1 }),
  smoothing_ms: num('Optional waveform smoothing window in milliseconds. Default 45.', { minimum: 0, maximum: 1_000 }),
  minimum_hold_frames: int('Optional minimum frames before changing mouth state. Default 2.', { minimum: 1, maximum: 120 }),
  sync_offset_ms: num('Optional visual sync offset in milliseconds. Default 0.', { minimum: -5_000, maximum: 5_000 }),
})

const spriteReplacementSchema = () => obj({
  replacements: list('Explicit old→new asset mappings.', obj({
    from_asset_id: str('Exact currently-used sprite asset ID.'),
    to_asset_id: str('Exact replacement sprite asset ID.'),
  }, ['from_asset_id', 'to_asset_id'])),
  clip_ids: list('Optional clip allow-list. Omit to inspect all clips in the open timeline.', str('Exact clip ID.')),
}, ['replacements'])

const PNGTUBER_TOOLS: AgentTool[] = [
  {
    name: 'plan_pngtuber_mouth_sync',
    description: 'Preview closed/open PNGTuber mouth intervals from the cached waveform of one narration clip. Uses the clip’s real source in-point and playback speed, never mutates the timeline, and returns a bounded plan for review before any sprite edit is applied.',
    inputSchema: obj({ clip_id: str('Exact narration clip ID from get_project or inspect_all_timelines.'), ...mouthSyncTuningSchema() }, ['clip_id']),
    run: async args => {
      const project = getProject()
      const { clipId, asset, intervals } = buildMouthIntervals(project, args)
      const preview = intervals.slice(0, MAX_PNGTUBER_PREVIEW_INTERVALS)
      return { clip_id: clipId, asset_id: asset.id, asset_name: asset.name, fps: project.settings.fps, interval_count: intervals.length, intervals: preview, truncated: preview.length < intervals.length, mutation_applied: false }
    },
  },
  {
    name: 'propose_pngtuber_mouth_sync',
    description: 'Create a stale-safe review proposal that materializes one narration clip’s waveform-driven closed/open mouth states as PNGTuber image clips. Requires exact narration, reference sprite, closed/open asset and destination-track IDs; never guesses filenames or mutates the live timeline. Apply only through the existing approval path.',
    inputSchema: obj({
      clip_id: str('Exact narration clip ID.'),
      reference_sprite_clip_id: str('Exact image clip whose static visual styling should be inherited.'),
      closed_asset_id: str('Exact closed-mouth image asset ID.'),
      open_asset_id: str('Exact open-mouth image asset ID.'),
      destination_track_id: str('Exact unlocked video track ID where generated mouth clips will be placed.'),
      ...mouthSyncTuningSchema(),
    }, ['clip_id', 'reference_sprite_clip_id', 'closed_asset_id', 'open_asset_id', 'destination_track_id']),
    run: async args => {
      const project = getProject()
      const { clipId, intervals } = buildMouthIntervals(project, args)
      if (intervals.length > MAX_PNGTUBER_PREVIEW_INTERVALS) throw new Error(`Mouth sync would create ${intervals.length} clips; tune or split the narration below the ${MAX_PNGTUBER_PREVIEW_INTERVALS} clip safety cap.`)
      const referenceId = String(args.reference_sprite_clip_id ?? '')
      const reference = project.clips[referenceId]
      if (!reference) throw new Error(`Unknown reference sprite clip ID: ${referenceId}`)
      if (reference.kind !== 'image' || !reference.assetId) throw new Error('Reference sprite clip must be an image clip.')
      const closedAssetId = String(args.closed_asset_id ?? '')
      const openAssetId = String(args.open_asset_id ?? '')
      for (const [label, assetId] of [['closed', closedAssetId], ['open', openAssetId]] as const) {
        const asset = project.assets[assetId]
        if (!asset) throw new Error(`Unknown ${label}-mouth asset ID: ${assetId}`)
        if (asset.kind !== 'image') throw new Error(`${label}-mouth asset must be an image.`)
      }
      const destinationTrackId = String(args.destination_track_id ?? '')
      const track = project.tracks.find(track => track.id === destinationTrackId)
      if (!track) throw new Error(`Unknown destination track ID: ${destinationTrackId}`)
      if (track.kind !== 'video') throw new Error('PNGTuber mouth clips require a video destination track.')
      if (track.locked) throw new Error('PNGTuber mouth destination track is locked.')
      const generated = materializeMouthSyncClips(intervals, reference, {
        destinationTrackId,
        closedAssetId,
        openAssetId,
        clipIds: intervals.map(() => uid('clip')),
      })
      const sequenceId = project.sequence?.id ?? 'main'
      const patch = {
        format: 'lumen-ai-patch' as const,
        version: 1 as const,
        projectId: project.id,
        edits: generated.map(clip => ({ op: 'addClip' as const, sequenceId, clipId: clip.id, clip })),
      }
      const proposal = previewAnimeAiPatch(project, patch)
      return { narration_clip_id: clipId, generated_clip_count: generated.length, proposal, mutation_applied: false, requires_approval: true }
    },
  },
  {
    name: 'plan_pngtuber_sprite_replacement',
    description: 'Preview an explicit PNGTuber sprite-version replacement (for example A assets to matching B assets) without changing timing, transforms, effects, keyframes or the timeline. Only exact asset-ID mappings are considered; no filename guessing is performed.',
    inputSchema: spriteReplacementSchema(),
    run: async args => {
      const operations = buildSpriteReplacementPlan(getProject(), args)
      return { replacement_count: operations.length, operations, mutation_applied: false, preserves_timing_and_clip_properties: true }
    },
  },
  {
    name: 'propose_pngtuber_sprite_replacement',
    description: 'Create a stale-safe review proposal for explicit PNGTuber sprite-version replacements. This validates the same exact old→new asset mappings as the planner, builds setAsset edits, previews their before/after clip changes and project fingerprint, and does not mutate the live timeline. Apply only through the existing approved-proposal path after review.',
    inputSchema: spriteReplacementSchema(),
    run: async args => {
      const project = getProject()
      const operations = buildSpriteReplacementPlan(project, args)
      const sequenceId = project.sequence?.id ?? 'main'
      const patch = { format: 'lumen-ai-patch' as const, version: 1 as const, projectId: project.id, edits: operations.map(operation => ({ op: 'setAsset' as const, sequenceId, clipId: operation.clipId, assetId: operation.replacementAssetId })) }
      const proposal = previewAnimeAiPatch(project, patch)
      return { replacement_count: operations.length, proposal, mutation_applied: false, requires_approval: true, preserves_timing_and_clip_properties: true }
    },
  },
]

export const ANIME_REVIEW_TOOLS: AgentTool[] = [
  {
    name: 'inspect_all_timelines',
    description: 'List the open and nested timelines with stable clip IDs, track IDs, start frames, durations and marker IDs. Does not switch timelines or change the project.',
    inputSchema: obj({}),
    run: async () => ({ timelines: inspectTimelines(getProject()) }),
  },
  {
    name: 'list_timeline_markers',
    description: 'List exact marker IDs, frames and labels on the open or a named nested timeline. Use these IDs for safe marker edits rather than guessing.',
    inputSchema: obj({ sequence_id: str('Optional nested timeline ID; omit for the open timeline.') }),
    run: async (args) => ({ sequence_id: typeof args.sequence_id === 'string' ? args.sequence_id : getProject().sequence?.id ?? 'main', markers: listTimelineMarkers(getProject(), typeof args.sequence_id === 'string' ? args.sequence_id : undefined) }),
  },
  {
    name: 'edit_timeline_marker',
    description: 'Add, update or remove one marker by its stable ID on the open or nested timeline. Atomic, undoable and non-ripple: never moves clips. First call list_timeline_markers to identify the correct marker.',
    inputSchema: obj({
      operation: oneOf('Marker operation', ['add', 'update', 'remove']), id: str('Exact marker ID. For add, choose a unique new ID.'), sequence_id: str('Optional timeline ID; omit for open timeline.'), frame: num('Timeline frame. Required for add, optional for update; never seconds.'), label: str('Marker label. Required for add, optional for update.'), color: oneOf('Optional marker colour', ['lime', 'violet', 'pink', 'amber', 'emerald', 'sky']),
    }, ['operation', 'id']),
    run: async args => {
      const op = args.operation
      const id = args.id
      if (typeof id !== 'string' || !id.trim()) throw new Error('Marker ID required')
      const sequenceId = typeof args.sequence_id === 'string' ? args.sequence_id : undefined
      const frame = typeof args.frame === 'number' ? args.frame : undefined
      const label = typeof args.label === 'string' ? args.label : undefined
      const color = typeof args.color === 'string' ? args.color as 'lime' | 'violet' | 'pink' | 'amber' | 'emerald' | 'sky' : undefined
      if (op === 'add' && (frame === undefined || label === undefined)) throw new Error('Add requires frame and label')
      if (op !== 'add' && op !== 'update' && op !== 'remove') throw new Error('Unknown marker operation')
      const change = op === 'add' ? { op: 'add' as const, id, frame: frame!, label: label!, color, sequenceId } : op === 'remove' ? { op: 'remove' as const, id, sequenceId } : { op: 'update' as const, id, frame, label, color, sequenceId }
      const result = useEditor.getState().applyAiMarkerChanges([change])
      if (!result.ok) throw new Error(result.error)
      return { ok: true, ...result.result as object, undoable: true }
    },
  },
  {
    name: 'query_context_bank',
    description: 'Retrieve a compact, persistent slice of project context already learned by Lumen: current timeline clips/markers, source identities and recent committed edits. Use it before making or refining an edit decision instead of re-inspecting the whole project. Prefer a narrow timeline range. This reads cached context only; it does not analyse media.',
    inputSchema: obj({ purpose: str('What decision this context is for, e.g. “refine the narration cut after this sentence”. Keep it specific.'), sequence_id: str('Optional exact timeline ID. Omit to query across timelines.'), start_frame: int('Optional inclusive start frame of the relevant timeline range.', { minimum: 0 }), end_frame: int('Optional exclusive end frame; must be after start_frame when both are supplied.', { minimum: 0 }), max_items: int('Optional result-item budget. Defaults to 80 and is hard-capped at 200.', { minimum: 1, maximum: 200 }), max_characters: int('Optional serialized context budget. Defaults to 12000 and is hard-capped at 28000.', { minimum: 500, maximum: 28000 }) }, ['purpose']),
    run: async args => {
      if (!desktop) throw new Error('The Context Bank needs the Lumen desktop app.')
      const request = makeContextBankQuery(args, useSession.getState().path, getProject().id)
      await flushContextBankWrites()
      return desktop.contextBank.query(request)
    },
  },
  ...CONTEXT_BANK_ANALYSIS_TOOLS,
  ...CONTEXT_BANK_RESEARCH_TOOLS,
  SOURCE_SCENE_SEARCH_TOOL,
  ANIME_ROUGH_CUT_TOOL,
  ...PNGTUBER_TOOLS,
]

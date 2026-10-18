/** Video-specific editorial brief and deterministic timeline diagnostics.
 * Pure functions: no footage is changed without a reviewed patch.
 */
import type { Project, Clip } from './types'

export type VideoFormat = 'anime-review' | 'gaming-highlights' | 'challenge-run' | 'short-form' | 'custom'
export type EditorialGoal = 'clarity' | 'pacing' | 'comedy' | 'atmosphere' | 'evidence' | 'retention'
export interface VideoBrief {
  format: VideoFormat
  audience: string
  premise: string
  targetSeconds?: number
  goals: EditorialGoal[]
  tone: string
  rules: {
    protectDialogue: boolean
    preserveClipGroups: boolean
    protectExistingSync: boolean
    avoidUnsupportedClaims: boolean
    requireApprovalForDestructiveEdits: boolean
    maximumConsecutiveBrollSeconds?: number
  }
  notes: string[]
}
export interface QualityFinding {
  severity: 'error' | 'warning' | 'suggestion'
  code: string
  sequenceId: string
  clipIds: string[]
  atFrame: number
  message: string
  recommendation: string
}
export interface QualityReport { brief: VideoBrief; findings: QualityFinding[]; sequenceSummaries: { id: string; durationFrames: number; durationSeconds: number; clips: number }[] }

export function defaultVideoBrief(format: VideoFormat): VideoBrief {
  const common = { protectDialogue: true, preserveClipGroups: true, protectExistingSync: true, avoidUnsupportedClaims: true, requireApprovalForDestructiveEdits: true }
  const defaults: Record<VideoFormat, Pick<VideoBrief, 'goals' | 'tone' | 'notes'>> = {
    'anime-review': { goals: ['clarity', 'evidence', 'comedy', 'pacing'], tone: 'Conversational, pointed, evidence-led', notes: ['Prefer footage supporting the exact spoken claim', 'Keep evidence on screen long enough to read', 'Do not replace source material with invented evidence'] },
    'gaming-highlights': { goals: ['comedy', 'retention', 'pacing'], tone: 'Natural and reaction-led', notes: ['Preserve setup and payoff', 'Do not remove context required to understand a joke'] },
    'challenge-run': { goals: ['clarity', 'retention', 'comedy'], tone: 'Tense but playful', notes: ['Explain rules early', 'Preserve attempts and failures that establish stakes'] },
    'short-form': { goals: ['retention', 'clarity', 'pacing'], tone: 'Immediate and concise', notes: ['Keep captions readable', 'Keep the payoff, not just the hook'] },
    custom: { goals: ['clarity', 'pacing'], tone: 'Defined by the creator', notes: [] },
  }
  return { format, audience: '', premise: '', ...defaults[format], rules: common }
}

const clipsOf = (record: Record<string, Clip>) => Object.values(record ?? {})
export function assessVideoQuality(project: Project, brief: VideoBrief): QualityReport {
  const findings: QualityFinding[] = []
  const summaries: QualityReport['sequenceSummaries'] = []
  const sequences = [{ id: project.sequence?.id ?? 'main', settings: project.settings, tracks: project.tracks, clips: project.clips }, ...Object.values(project.sequences ?? {})]
  for (const seq of sequences) {
    const clips = clipsOf(seq.clips)
    const trackIds = new Set(seq.tracks.map(t => t.id))
    const durationFrames = clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0)
    const fps = seq.settings.fps
    summaries.push({ id: seq.id, durationFrames, durationSeconds: fps > 0 ? durationFrames / fps : 0, clips: clips.length })
    const report = (severity: QualityFinding['severity'], code: string, affected: Clip[], message: string, recommendation: string) => findings.push({ severity, code, sequenceId: seq.id, clipIds: affected.map(c => c.id), atFrame: Math.max(0, affected[0]?.start ?? 0), message, recommendation })
    if (!Number.isFinite(fps) || fps <= 0) report('error', 'invalid-fps', [], 'Invalid timeline frame rate', 'Correct the sequence settings before editing')
    const groups = new Map<string, Clip[]>()
    for (const c of clips) {
      if (!Number.isSafeInteger(c.start) || c.start < 0 || !Number.isSafeInteger(c.duration) || c.duration <= 0) report('error', 'invalid-timing', [c], 'Clip has invalid frame timing', 'Repair start and duration')
      if (!trackIds.has(c.trackId)) report('error', 'orphan-track', [c], 'Clip refers to a missing track', 'Relink to an existing track')
      if (c.assetId && !project.assets[c.assetId]) report('error', 'orphan-asset', [c], 'Clip refers to missing media', 'Relink media before rendering')
      if (c.assetId && project.assets[c.assetId]?.source.missing) report('warning', 'offline-media', [c], 'Clip media is offline', 'Relink source media')
      if (c.groupId) groups.set(c.groupId, [...(groups.get(c.groupId) ?? []), c])
      if (c.audio && c.audio.fadeIn + c.audio.fadeOut > c.duration) report('warning', 'overlong-fades', [c], 'Audio fades exceed clip duration', 'Review audio fades')
      if (c.transitionIn && c.transitionIn.duration > c.duration) report('warning', 'overlong-transition', [c], 'Incoming transition exceeds clip duration', 'Shorten transition')
      if (c.kind === 'text' && c.text && c.text.content.trim().length === 0) report('suggestion', 'empty-text', [c], 'Text clip is empty', 'Check whether it is intentional')
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const offsets = group.map(c => c.start - group[0].start)
      if (new Set(offsets).size > 1) report('suggestion', 'offset-group', group, 'Grouped clips have differing offsets', 'Preserve relative offsets when moving the group; do not force alignment')
    }
    for (const track of seq.tracks) {
      const ordered = clips.filter(c => c.trackId === track.id).sort((a,b) => a.start - b.start)
      for (let i=1; i<ordered.length; i++) {
        const a = ordered[i-1], b = ordered[i]
        if (a.start + a.duration > b.start && track.kind === 'audio') report('suggestion', 'audio-overlap', [a,b], 'Audio clips overlap on one track', 'Listen for masking, clipping or intentional crossfade')
      }
    }
  }
  return { brief: structuredClone(brief), findings, sequenceSummaries: summaries }
}

export function createEditorialReviewPrompt(report: QualityReport): string {
  return [
    'Review this Lumen project as an editor, not as an automatic cutter.',
    `Format: ${report.brief.format}; premise: ${report.brief.premise}; audience: ${report.brief.audience}`,
    `Tone: ${report.brief.tone}; goals: ${report.brief.goals.join(', ')}`,
    `Rules: ${JSON.stringify(report.brief.rules)}`,
    `Creator notes: ${report.brief.notes.join(' | ')}`,
    'Only propose edits supported by the actual footage and transcript. Do not claim to have watched or heard media based only on timeline metadata.',
    'For each proposal, explain its purpose, exact sequence and frame range, what it risks damaging, and whether creator approval is required.',
    'Protect commentary sync, PNGTuber reactions, running jokes, and evidence shots. No destructive changes without explicit approval.',
    `Deterministic findings: ${JSON.stringify(report.findings)}`,
  ].join('\n')
}

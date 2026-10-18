/** Anime-review editorial planning. No claims about footage are inferred from metadata. */
import type { Project } from './types'

export type EvidenceStatus = 'unverified' | 'verified' | 'disputed' | 'not-applicable'
export type BeatPurpose = 'argument' | 'evidence' | 'context' | 'comparison' | 'joke' | 'reaction' | 'transition' | 'breathing-room'
export type VisualRole = 'source-footage' | 'source-still' | 'official-art' | 'diagram' | 'caption' | 'avatar' | 'cutaway' | 'none'
export interface ReviewBeat {
  id: string
  sequenceId: string
  startFrame: number
  endFrame: number
  purpose: BeatPurpose
  commentary: string
  claim?: string
  evidenceStatus: EvidenceStatus
  sourceNote?: string
  visualRole: VisualRole
  assetIds: string[]
  jokeGroup?: string
  locked?: boolean
  editorNote?: string
}
export interface ReviewPlan {
  format: 'lumen-anime-review-plan'
  version: 1
  projectId: string
  thesis: string
  intendedTone: string
  beats: ReviewBeat[]
}
export interface ReviewIssue {
  severity: 'error' | 'warning' | 'suggestion'
  code: string
  beatId: string
  message: string
}
export function newAnimeReviewPlan(project: Project): ReviewPlan {
  return { format: 'lumen-anime-review-plan', version: 1, projectId: project.id, thesis: '', intendedTone: 'Conversational, sharp, evidence-led, restrained visual effects', beats: [] }
}
export function validateAnimeReviewPlan(project: Project, plan: ReviewPlan): ReviewIssue[] {
  const issues: ReviewIssue[] = []
  if (plan.format !== 'lumen-anime-review-plan' || plan.version !== 1 || plan.projectId !== project.id) throw new Error('Plan format, version or project ID mismatch')
  const sequences = new Map<string, { clips: Project['clips'] }>()
  sequences.set(project.sequence?.id ?? 'main', project)
  for (const [id, sequence] of Object.entries(project.sequences ?? {})) sequences.set(id, sequence)
  const ids = new Set<string>()
  for (const beat of plan.beats) {
    const add = (severity: ReviewIssue['severity'], code: string, message: string) => issues.push({ severity, code, beatId: beat.id, message })
    if (ids.has(beat.id)) add('error', 'duplicate-id', 'Beat IDs must be unique')
    ids.add(beat.id)
    if (!Number.isSafeInteger(beat.startFrame) || !Number.isSafeInteger(beat.endFrame) || beat.startFrame < 0 || beat.endFrame <= beat.startFrame) add('error', 'invalid-range', 'Beat must have a positive, integer-frame range')
    const seq = sequences.get(beat.sequenceId)
    if (!seq) add('error', 'unknown-sequence', 'Beat references a missing timeline')
    for (const assetId of beat.assetIds) if (!project.assets[assetId]) add('error', 'unknown-asset', `Missing asset: ${assetId}`)
    if (beat.purpose === 'evidence' && beat.evidenceStatus !== 'verified') add('warning', 'unverified-evidence', 'Evidence should be checked against the actual episode/source before publication')
    if (beat.purpose === 'evidence' && !beat.sourceNote?.trim()) add('warning', 'missing-citation', 'Record episode, timestamp or source for this evidence')
    if (beat.purpose === 'joke' && beat.evidenceStatus === 'verified' && !beat.sourceNote) add('suggestion', 'joke-vs-evidence', 'Make sure the audience can distinguish a joke from a factual claim')
    if (beat.visualRole !== 'none' && beat.assetIds.length === 0) add('suggestion', 'visual-unassigned', 'Visual role is planned but no media asset has been selected')
    if (seq && beat.endFrame > Math.max(0, ...Object.values(seq.clips).map(c => c.start + c.duration))) add('suggestion', 'beyond-edit', 'Beat extends beyond the current timeline edit')
  }
  const sorted = [...plan.beats].sort((a,b) => a.sequenceId.localeCompare(b.sequenceId) || a.startFrame-b.startFrame)
  for (let i=1;i<sorted.length;i++) if (sorted[i].sequenceId===sorted[i-1].sequenceId && sorted[i].startFrame < sorted[i-1].endFrame && sorted[i].purpose === 'evidence' && sorted[i-1].purpose === 'evidence') issues.push({ severity: 'suggestion', code: 'overlapping-evidence', beatId: sorted[i].id, message: 'Evidence beats overlap; check that the claims remain understandable' })
  return issues
}
export function createAnimeReviewEditPrompt(project: Project, plan: ReviewPlan): string {
  const issues = validateAnimeReviewPlan(project, plan)
  return [
    'You are editing an anime review, not a trailer or generic highlight reel.',
    `Core thesis: ${plan.thesis || '[creator must supply thesis]'}`,
    `Tone: ${plan.intendedTone}`,
    'Treat the commentary as the structural spine. Preserve intent, context, pauses that serve jokes, and the creator’s natural speaking style.',
    'For each claim, choose between direct evidence, illustrative footage, diagrams, character art, or no visual change.',
    'Never present an illustrative clip or comedic cutaway as proof of a claim.',
    'Only label evidence verified after checking the actual footage and its source. Metadata alone is not proof.',
    'Prefer genuine screenshots and official art over generated replacements. Never invent dialogue, episode timestamps or production facts.',
    'Avoid excessive zooms, subtitles, reaction images, sound effects and rapid cuts. Let strong material breathe.',
    'Preserve existing PNGTuber timing and clip-group offsets. Do not move or delete locked beats.',
    'Make proposals first. Do not apply destructive timeline edits without approval.',
    `Review plan: ${JSON.stringify(plan)}`,
    `Outstanding checks: ${JSON.stringify(issues)}`,
  ].join('\n\n')
}

/** Conservative, explainable candidate selection for commentary-led anime reviews.
 * Does not inspect frames or verify factual claims. It ranks ONLY indexed source
 * transcripts/cues/tags and leaves the timeline unchanged.
 */
import type { Asset, Project } from './types'
import type { ReviewBeat, ReviewPlan } from './anime-review'

export interface FootageCandidate {
  beatId: string
  assetId: string
  sourceStartSeconds: number
  sourceEndSeconds: number
  score: number
  reasons: string[]
  evidenceVerified: false
  role: 'illustration' | 'possible-evidence' | 'comedic-cutaway'
}
export interface MatchOptions { maxPerBeat?: number; minimumScore?: number; paddingSeconds?: number }
const stop = new Set('a an the and or of to in on at by for from with is are was were be been this that it its as but so i you we they he she his her their about what when where how why not just very really more than then can could would should do does did'.split(' '))
const tokens = (s: string) => [...new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(w => !stop.has(w)))];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
function overlap(a: string[], b: string[]) { const bs = new Set(b); return a.filter(w => bs.has(w)) }
function assetWindows(asset: Asset): { start: number; end: number; text: string; origin: string }[] {
  const windows = [
    ...(asset.transcript ?? []).map(s => ({start:s.start,end:s.end,text:s.text,origin:'transcript'})),
    ...(asset.cues ?? []).map(c => ({start:c.at,end:c.at+(c.seconds ?? 3),text:[c.label,c.who,c.kind].filter(Boolean).join(' '),origin:'cue'})),
  ]
  if (!windows.length) windows.push({start:0,end:Math.min(asset.duration ?? 8,8),text:[asset.name,...(asset.tags ?? [])].join(' '),origin:'metadata'})
  return windows.filter(w => Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end > w.start)
}
export function rankAnimeFootage(project: Project, plan: ReviewPlan, options: MatchOptions = {}): Record<string, FootageCandidate[]> {
  if (plan.projectId !== project.id) throw new Error('Plan belongs to a different project')
  const max = clamp(Math.floor(options.maxPerBeat ?? 5),1,30)
  const threshold = clamp(options.minimumScore ?? 0.15,0,1)
  const pad = clamp(options.paddingSeconds ?? 1,0,10)
  const result: Record<string, FootageCandidate[]> = {}
  for (const beat of plan.beats) {
    result[beat.id] = []
    if (beat.locked || beat.visualRole === 'none' || beat.visualRole === 'avatar') continue
    const query = tokens([beat.commentary,beat.claim,beat.editorNote].filter(Boolean).join(' '))
    if (!query.length) continue
    const found: FootageCandidate[] = []
    for (const asset of Object.values(project.assets)) {
      if (!['video','image'].includes(asset.kind) || asset.source.missing) continue
      for (const w of assetWindows(asset)) {
        const matches = overlap(query,tokens([w.text,asset.name,...(asset.tags ?? [])].join(' ')))
        if (!matches.length) continue
        // Metadata-only matches are weaker than timed cues or transcripts.
        const strength = w.origin === 'metadata' ? .4 : w.origin === 'cue' ? .8 : 1
        const score = Math.round(1000 * strength * matches.length / Math.max(2,Math.sqrt(query.length * 2))) / 1000
        if (score < threshold) continue
        const end = asset.duration ?? w.end + pad
        const start = clamp(w.start-pad,0,end)
        const finish = clamp(w.end+pad,start,end)
        if (finish <= start) continue
        found.push({beatId:beat.id,assetId:asset.id,sourceStartSeconds:start,sourceEndSeconds:finish,score,
          reasons:[`Matched: ${matches.join(', ')}`,`Source: ${w.origin}`],evidenceVerified:false,
          role:beat.purpose === 'evidence' ? 'possible-evidence' : beat.purpose === 'joke' ? 'comedic-cutaway' : 'illustration'})
      }
    }
    found.sort((a,b)=>b.score-a.score || a.assetId.localeCompare(b.assetId) || a.sourceStartSeconds-b.sourceStartSeconds)
    result[beat.id]=found.slice(0,max)
  }
  return result
}

/** Approval-only handoff. No automatic timeline mutation, no invented source facts. */
export function createFootageReviewQueue(project: Project, plan: ReviewPlan, options?: MatchOptions) {
  const matches = rankAnimeFootage(project,plan,options)
  return plan.beats.map(beat => ({beatId:beat.id,commentary:beat.commentary,purpose:beat.purpose,
    locked:Boolean(beat.locked),requiresSourceVerification:beat.purpose === 'evidence',
    suggestions:matches[beat.id],decision:'pending-human-review' as const}))
}

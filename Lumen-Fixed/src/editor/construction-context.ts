/** Context retrieval for proposed cuts. Relationships come from the explicit
 * story map; transcript evidence is projected onto the actual timeline.
 * Neither a transcript gap nor a lexical match proves a scene is dispensable.
 */
import type { Project } from './types'
import type { ConstructionState, ConstructionCut, StoryBeat } from './video-construction'
import { timelineTranscript, type TimelineLine } from './smart'

export function relatedStoryContext(state: ConstructionState, cutId: string) {
  const cut = state.cuts.find(c => c.id === cutId)
  if (!cut) throw new Error(`Unknown construction cut: ${cutId}`)
  const byId = new Map(state.beats.map(b => [b.id,b]))
  const focus = byId.get(cut.beatId)
  if (!focus) throw new Error(`Missing story beat for cut: ${cutId}`)

  const dependencies: StoryBeat[] = []
  const ancestors: StoryBeat[] = []
  const seenDeps = new Set<string>()
  const visit = (id: string) => {
    if (seenDeps.has(id)) return
    seenDeps.add(id)
    const beat = byId.get(id)
    if (!beat) return
    for (const parent of beat.parentId ? [beat.parentId] : []) {
      const item=byId.get(parent)
      if (item && !ancestors.some(b=>b.id===item.id)) ancestors.push(item)
    }
    for (const dep of beat.dependsOn) {
      visit(dep)
      const item=byId.get(dep)
      if (item && !dependencies.some(b=>b.id===item.id)) dependencies.push(item)
    }
  }
  visit(focus.id)
  const anchors = new Set([focus.id, ...dependencies.map(b=>b.id), ...ancestors.map(b=>b.id)])
  const related = state.beats
    .filter(b=>b.id!==focus.id && !dependencies.some(d=>d.id===b.id)
      && b.dependsOn.some(dep=>anchors.has(dep)))
    .sort((a,b)=>a.start-b.start)
  const nearby = state.beats.filter(b=>b.id!==focus.id && b.kind!=='chapter')
    .sort((a,b)=>{
      const distance=(v:StoryBeat)=>v.end<cut.start?cut.start-v.end:v.start>cut.end?v.start-cut.end:0
      return distance(a)-distance(b) || a.start-b.start
    }).slice(0,8)
  return {cut,focus,ancestors,dependencies,related,nearby,
    note:'Explicit dependency links indicate continuity to investigate; unlinked moments may still matter. Review the actual audiovisual footage before deleting.'}
}

export interface SpeechBoundaryViolation {
  edge:'start'|'end'
  frame:number
  line:TimelineLine
}

/** Uses available timed transcript phrases, NOT word-level audio detection.
 * A phrase split is a hard reject; untranscribed dialogue remains unknown.
 */
export function speechCutContext(
  project: Project, cut: Pick<ConstructionCut,'start'|'end'>, contextSeconds = 12,
) {
  const fps=project.settings.fps
  if (!Number.isInteger(cut.start) || !Number.isInteger(cut.end) || cut.start<0 || cut.end<=cut.start)
    throw new Error('Invalid frame range for speech boundary check')
  const start=cut.start/fps,end=cut.end/fps
  const seconds=Math.max(0,Math.min(60,contextSeconds))
  const lines=timelineTranscript(project,Math.max(0,start-seconds),end+seconds)
  const violations:SpeechBoundaryViolation[]=[]
  for(const [edge,frame] of [['start',cut.start],['end',cut.end]] as const) {
    for(const line of lines) {
      if(line.start*fps < frame-1e-6 && line.end*fps > frame+1e-6) violations.push({edge,frame,line})
    }
  }
  const before=lines.filter(line=>line.end<=start && line.end>=start-seconds).slice(-30)
  const removed=lines.filter(line=>line.end>start && line.start<end).slice(0,60)
  const after=lines.filter(line=>line.start>=end && line.start<=end+seconds).slice(0,30)
  return {before,removed,after,violations,transcriptLines:lines.length,
    limitation:'Only available phrase-level transcripts are checked. Silence, missing transcripts and audio metrics do not establish that dialogue, laughter or reactions are safe to remove.'}
}

export function assertSpeechSafeCuts(project:Project,cuts:ConstructionCut[]) {
  for(const cut of cuts) {
    const report=speechCutContext(project,cut,1)
    if(report.violations.length) {
      const first=report.violations[0]
      throw new Error(`Cut ${cut.id} interrupts transcribed speech at its ${first.edge} boundary (frame ${first.frame}): ${first.line.text.slice(0,120)}. Refine the frame boundaries and inspect audio.`)
    }
  }
}

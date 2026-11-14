/** Persistent editorial intent. All ranges are half-open integer timeline frames.
 * Receipts describe tool inspection, not a guarantee that an AI understood it.
 */
import { z } from 'zod'
import type { Project } from './types'
import type { JoinAudioReport } from './construction-join-audio'
import { projectFingerprint } from './anime-review-approval'

const frame = z.number().int().nonnegative()
const text = z.string().trim().min(1).max(2000)
const id = z.string().trim().min(1).max(128)
const range = z.object({ start:frame, end:frame }).refine(r=>r.end>r.start,'Empty range')
const protectedRange = z.object({ start:frame,end:frame,reason:text })
const beatSchema = z.object({
  id, start:frame,end:frame,kind:z.enum(['chapter','scene','setup','payoff','reaction','callback','continuity']),
  summary:text,parentId:id.optional(),dependsOn:z.array(id).max(64).default([]),
  protectedRanges:z.array(protectedRange).max(100).default([]),
})
const coverageSchema = z.object({id,start:frame,end:frame,visual:text,audio:text,evidenceIds:z.array(id).min(1).max(64)})
const cutSchema = z.object({id,start:frame,end:frame,reason:text,beatId:id,evidenceIds:z.array(id).min(1).max(64),audioReason:text,visualReason:text})
export type FrameRange = z.infer<typeof range>
export type StoryBeat = z.infer<typeof beatSchema>
export type ConstructionCut = z.infer<typeof cutSchema>
export interface InspectionReceipt extends FrameRange {id:string;frames:number[];audio:boolean;transcript:boolean}
export interface ContextInspectionReceipt {cutId:string;storySignature:string}
export interface ConstructionJoinAudioCheck {frame:number;fingerprint:string;report:JoinAudioReport|null}
export interface ConstructionJoinVerdict {frame:number;verdict:'accept'|'repair';reason:string}
export interface ConstructionState {
  version:1; paused?:boolean; projectId:string;sequenceId:string;fingerprint:string;goal:string;fps:number;scope:FrameRange[];
  coverage:z.infer<typeof coverageSchema>[];beats:StoryBeat[];cuts:ConstructionCut[];inspections:InspectionReceipt[];
  contextInspections?:ContextInspectionReceipt[];
  joinAudioChecks?:ConstructionJoinAudioCheck[];
  repairOf?:{fingerprint:string;targetFrames:number[];issues:string[];depth:number};
  applied?:{fingerprint:string;joins:number[]};
  review?:{fingerprint:string;joins:number[];story:string;pacing:string;issues:string[];joinVerdicts?:ConstructionJoinVerdict[]};
}
declare module './types' { interface Project { construction?:ConstructionState } }
export function constructionFingerprint(p:Project) {
  // Derived transcripts, peaks and research arrive during investigation. They
  // must not invalidate the timeline or force the AI to analyse it again.
  const assets = Object.fromEntries(Object.values(p.assets).map(asset => {
    const source = asset.source
    return [asset.id, { kind: asset.kind, duration: asset.duration, fps: asset.fps,
      width: asset.width, height: asset.height,
      source: source.type === 'file' ? { type: source.type, path: source.path ?? source.url,
        size: source.size, mtime: source.mtime, mime: source.mime, missing: source.missing } : {
        type: source.type, dir: source.dir ?? source.base, pattern: source.pattern,
        frameCount: source.frameCount, fps: source.fps, missing: source.missing } }]
  }))
  return projectFingerprint({ id: p.id, settings: p.settings, tracks: p.tracks,
    clips: p.clips, markers: p.markers, sequences: p.sequences, sequence: p.sequence,
    master: p.master, assets, luts: p.luts, fonts: p.fonts } as unknown as Project)
}
/** Invalidate earlier context reads whenever any cut or story dependency changes. */
export function constructionStorySignature(s:ConstructionState) {
  const data=JSON.stringify([s.fps,s.beats,s.cuts])
  let hash=2166136261
  for(let i=0;i<data.length;i++) hash=Math.imul(hash^data.charCodeAt(i),16777619)
  return `${data.length}:${(hash>>>0).toString(16)}`
}
export function mergeRanges(ranges:FrameRange[]):FrameRange[] {
  const out:FrameRange[]=[]
  for(const r of [...ranges].sort((a,b)=>a.start-b.start)) {
    const last=out.at(-1)
    if(last && r.start<=last.end) last.end=Math.max(last.end,r.end)
    else out.push({...r})
  }
  return out
}
function inside(r:FrameRange, scope:FrameRange[]) { return scope.some(s=>r.start>=s.start && r.end<=s.end) }
function overlap(a:FrameRange,b:FrameRange) {return a.start<b.end && b.start<a.end}
export function beginConstruction(p:Project,goal:string):ConstructionState {
  text.parse(goal)
  const scope=mergeRanges(Object.values(p.clips).map(c=>({start:c.start,end:c.start+c.duration})))
  if(!scope.length) throw new Error('Put the permitted footage on the timeline first.')
  scope.forEach(r=>range.parse(r))
  return {version:1,projectId:p.id,sequenceId:p.sequence?.id??'main',fingerprint:constructionFingerprint(p),goal,fps:p.settings.fps,scope,coverage:[],beats:[],cuts:[],inspections:[],contextInspections:[]}
}
function assertFresh(p:Project,s:ConstructionState) {
  if(s.projectId!==p.id || s.sequenceId!==(p.sequence?.id??'main') || (s.applied?.fingerprint??s.fingerprint)!==constructionFingerprint(p)) throw new Error('Timeline changed: construction is stale. Re-map the current timeline before editing.')
}
export function uncoveredRanges(s:ConstructionState) {
  let holes=s.scope.map(r=>({...r}))
  for(const c of s.coverage) holes=holes.flatMap(h=>!overlap(c,h)?[h]:[
    ...(h.start<c.start?[{start:h.start,end:c.start}]:[]),...(h.end>c.end?[{start:c.end,end:h.end}]:[]),
  ])
  return holes
}
function validateRecords(s:ConstructionState) {
  if(s.version!==1) throw new Error('Unsupported construction version')
  z.array(coverageSchema).max(3000).parse(s.coverage)
  z.array(beatSchema).max(1000).parse(s.beats)
  z.array(cutSchema).max(1000).parse(s.cuts)
  for(const collection of [s.coverage,s.beats,s.cuts]) {
    if(new Set(collection.map(x=>x.id)).size!==collection.length) throw new Error('Duplicate record IDs')
    for(const r of collection) { range.parse(r); if(!inside(r,s.scope)) throw new Error('Range outside permitted timeline scope') }
  }
  const byId=new Map(s.beats.map(b=>[b.id,b]))
  const visited=new Set<string>(), visiting=new Set<string>()
  function visit(b:StoryBeat) {
    if(visiting.has(b.id)) throw new Error('Cyclic story dependencies')
    if(visited.has(b.id)) return
    visiting.add(b.id)
    for(const dep of b.dependsOn) {
      const d=byId.get(dep); if(!d) throw new Error(`Missing dependency ${dep}`)
      visit(d)
    }
    if(b.parentId) {
      const parent=byId.get(b.parentId)
      if(!parent || !inside(b,[parent])) throw new Error('Missing parent or child outside parent scene')
      visit(parent)
    }
    for(const r of b.protectedRanges) { range.parse(r); if(!inside(r,[b])) throw new Error('Protected range outside beat') }
    visiting.delete(b.id);visited.add(b.id)
  }
  s.beats.forEach(visit)
  for(const c of [...s.coverage,...s.cuts]) {
    const evidence=c.evidenceIds.map(id=>s.inspections.find(i=>i.id===id))
    if(evidence.some(e=>!e)) throw new Error('Unknown inspection receipt')
    const receipts=evidence as InspectionReceipt[]
    if(!inside(c,mergeRanges(receipts.filter(i=>i.audio && i.frames.length).map(i=>({start:i.start,end:i.end}))))) throw new Error('Inspection must cover the range with both visual frames and audio analysis')
  }
  if(s.contextInspections!==undefined) z.array(z.object({cutId:id,storySignature:id})).max(1000).parse(s.contextInspections)
  const sorted=[...s.cuts].sort((a,b)=>a.start-b.start)
  for(let i=1;i<sorted.length;i++) if(overlap(sorted[i-1],sorted[i])) throw new Error('Overlapping cuts')
}
export function updateConstruction(s:ConstructionState,raw:unknown):ConstructionState {
  if(s.applied) throw new Error('Already applied: review the output or begin a new pass')
  const changes=z.object({coverage:z.array(coverageSchema).max(3000).optional(),beats:z.array(beatSchema).max(1000).optional(),cuts:z.array(cutSchema).max(1000).optional()}).strict().parse(raw)
  const next={...structuredClone(s),...changes};validateRecords(next);return next
}
export function validateConstructionCuts(p:Project,s:ConstructionState):ConstructionCut[] {
  assertFresh(p,s)
  if(s.applied) throw new Error('This construction pass was already applied')
  if(s.paused) throw new Error('Construction is paused; resume explicitly before applying')
  validateRecords(s)
  if(uncoveredRanges(s).length) throw new Error('Investigate missing audiovisual coverage before cutting')
  if(!s.beats.length || !s.cuts.length) throw new Error('Map story beats and propose cuts before applying')
  if(p.tracks.some(t=>t.locked && Object.values(p.clips).some(c=>c.trackId===t.id))) throw new Error('Locked tracks could lose sync during ripple cuts; resolve them first')
  if(s.cuts.reduce((n,c)=>n+c.end-c.start,0)>=s.scope.reduce((n,r)=>n+r.end-r.start,0)) throw new Error('Cannot remove the entire video')
  for(const c of s.cuts) {
    if(!s.beats.some(b=>b.id===c.beatId && inside(c,[b]))) throw new Error('Cut must belong to its containing scene or chapter')
    for(const b of s.beats) {
      if(b.protectedRanges.some(r=>overlap(r,c))) throw new Error(`Cut damages protected moment: ${b.summary}`)
      const retained=s.cuts.filter(x=>overlap(x,b)).reduce((n,x)=>n+Math.min(x.end,b.end)-Math.max(x.start,b.start),0)<b.end-b.start
      if(retained) for(const dep of b.dependsOn) {
        const setup=s.beats.find(x=>x.id===dep)!
        if(overlap(setup,c)) throw new Error(`Cut damages required setup/dependency ${dep}; refine the dependency to its essential range`)
      }
    }
    const frames=new Set(s.inspections.filter(i=>c.evidenceIds.includes(i.id)).flatMap(i=>i.frames))
    for(const edge of [c.start,c.end]) for(const f of [edge-1,edge,edge+1]) {
      if(inside({start:f,end:f+1},s.scope) && !frames.has(f)) throw new Error(`Inspect adjacent frames at cut boundary ${edge}`)
    }
    if(!s.contextInspections?.some(i=>i.cutId===c.id && i.storySignature===constructionStorySignature(s)))
      throw new Error(`Inspect cross-scene context for cut ${c.id} after finalizing its story links and cut frames`)
  }
  return [...s.cuts].sort((a,b)=>b.start-a.start)
}
export function constructionStatus(p:Project,s:ConstructionState) {
  try {assertFresh(p,s)} catch(error) {return {stage:'stale',uncovered:[],next:String(error),complete:false}}
  if(s.paused) return {stage:'paused',complete:false,uncovered:[],next:'Resume explicitly to continue construction'}
  if(s.applied) {
    const review=s.review
    const complete=!!review && review.fingerprint===s.applied.fingerprint && !review.issues.length && s.applied.joins.every(j=>review.joins.includes(j))
    return {stage:complete?'complete':'review',complete,uncovered:[],next:complete?'Finished editorial checks':'Inspect edited join frames and rendered join audio, then review story and pacing across the whole output'}
  }
  const uncovered=uncoveredRanges(s)
  return {stage:uncovered.length?'investigate':s.beats.length?'refine':'map',complete:false,uncovered,next:uncovered.length?'Inspect uncovered timeline ranges with audio and pictures':s.beats.length?'Refine scene cuts, call inspect_cut_context for each cut, inspect neighbouring frames and validate dialogue boundaries':'Map chapters, scenes, setups, payoffs and their dependencies'}
}
export function nextEventProbe(left:number,right:number,leftPresent:boolean,rightPresent:boolean,singleChange:boolean) {
  range.parse({start:left,end:right})
  if(!singleChange) throw new Error('Scan first: repeating or uncertain events cannot use bisection safely')
  if(leftPresent===rightPresent) throw new Error('The endpoints must bracket a change')
  return {frame:right-left===1?right:Math.floor((left+right)/2),done:right-left===1}
}

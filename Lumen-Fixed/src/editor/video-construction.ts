/** Persistent editorial intent. All ranges are half-open integer timeline frames.
 * Receipts describe tool inspection, not a guarantee that an AI understood it.
 */
import { z } from 'zod'
import type { Project } from './types'
import type { JoinAudioReport } from './construction-join-audio'
import type { EventSignal } from './construction-event-index'
import { planConstructionSections, type BankedSection, type PlannedSection } from './construction-sections'
import type { ImmutableSourceManifest, SourceSelection, SourceClipMap, SelectionOutputMap } from './construction-assembler'
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
export interface InspectionReceipt extends FrameRange {id:string;frames:number[];audio:boolean;transcript:boolean;mode?:'overview'|'boundary'|'focused'}
export interface ContextInspectionReceipt {cutId:string;storySignature:string}
export interface DiscoveryScan extends FrameRange {id:string;fingerprint:string;visualFrames:number[];audioMeasured:boolean;transcriptLines:number;eventCount:number}
export interface DiscoveryEvent extends FrameRange {
  id:string;scanId:string;signal:EventSignal;strength:number;description:string;
  visualFrames:number[];transcriptClipIds:string[];sourceClipIds:string[];
  decision?:'keep'|'discard'|'uncertain';decisionReason?:string;inspectionIds?:string[];
}
export interface ConstructionAudioSample {id:string;start:number;end:number;fingerprint:string;purpose:string}
export interface ConstructionAudioObservation {id:string;sampleId:string;eventType:'speech_delivery'|'laughter'|'game_sound'|'music'|'silence'|'uncertain';summary:string;audibleCues:string;confidence:'low'|'medium'|'high';uncertainty:string}
export interface ConstructionJoinAudioCheck {frame:number;fingerprint:string;report:JoinAudioReport|null}
export interface ConstructionJoinVerdict {frame:number;verdict:'accept'|'repair';reason:string}
export interface ConstructionSectionPlan {
  originalFrames:number;contextTargetFrames:number;editTargetFrames:number;
  context:BankedSection[];editing:(PlannedSection & {planned?:boolean;summary?:string;evidenceIds?:string[];linkedContextIds?:string[]})[];
  reads?:{editSectionId:string;bankSectionIds:string[];revision:number;question?:string}[];
}
export interface ConstructionState {
  /** Deep source snapshot is never modified by an output edit or repair. */
  sourceManifest?:ImmutableSourceManifest
  /** Keep-first editable source selections, ordered as intended in the output. */
  sourceSelections?:SourceSelection[]
  /** Reversible source to output map for precise reconstruction and review. */
  assembly?:{sequenceId:string;sourceSequenceId:string;sourceFingerprint:string;
    selections:SelectionOutputMap[];clips:SourceClipMap[];outputFrames:number}
  sections?:ConstructionSectionPlan;
  version:1; paused?:boolean; discoveryRequired?:boolean; revision?:number; projectId:string;sequenceId:string;fingerprint:string;goal:string;fps:number;scope:FrameRange[];
  coverage:z.infer<typeof coverageSchema>[];beats:StoryBeat[];cuts:ConstructionCut[];inspections:InspectionReceipt[];
  contextInspections?:ContextInspectionReceipt[];
  discoveryScans?:DiscoveryScan[];
  discoveryEvents?:DiscoveryEvent[];
  audioSamples?:ConstructionAudioSample[];
  audioObservations?:ConstructionAudioObservation[];
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
export function beginConstruction(p:Project,goal:string,sectioned=false):ConstructionState {
  text.parse(goal)
  const scope=mergeRanges(Object.values(p.clips).map(c=>({start:c.start,end:c.start+c.duration})))
  if(!scope.length) throw new Error('Put the permitted footage on the timeline first.')
  scope.forEach(r=>range.parse(r))
  const scheduled=sectioned?planConstructionSections(scope,p.settings.fps,
    [...p.markers.map(m=>({start:m.frame,end:m.frame+1,kind:'chapter',strength:1})),
      ...Object.values(p.clips).flatMap(c=>[
        {start:c.start,end:c.start+1,kind:'clip-boundary',strength:1},
        {start:c.start+c.duration,end:c.start+c.duration+1,kind:'clip-boundary',strength:1},
      ])]):null
  const fingerprint=constructionFingerprint(p)
  const sourceManifest=sectioned?{
    fingerprint,sequenceId:p.sequence?.id??'seq_main',
    settings:structuredClone(p.settings),tracks:structuredClone(p.tracks),
    clips:structuredClone(p.clips),markers:structuredClone(p.markers),
  }:undefined
  const sections=scheduled?{
    originalFrames:scheduled.totalFrames,
    contextTargetFrames:scheduled.contextTargetFrames,
    editTargetFrames:scheduled.editTargetFrames,
    context:scheduled.context,editing:scheduled.editing,reads:[],
  }:undefined
  return {version:1,discoveryRequired:true,revision:0,sections,sourceManifest,sourceSelections:[],projectId:p.id,sequenceId:p.sequence?.id??'main',fingerprint,goal,fps:p.settings.fps,scope,coverage:[],beats:[],cuts:[],inspections:[],contextInspections:[],discoveryScans:[],discoveryEvents:[]}
}
function assertFresh(p:Project,s:ConstructionState) {
  const requiredSequence=s.assembly&&s.applied?s.assembly.sequenceId:s.sequenceId
  if(s.projectId!==p.id || requiredSequence!==(p.sequence?.id??'main') || (s.applied?.fingerprint??s.fingerprint)!==constructionFingerprint(p)) throw new Error('Timeline changed: construction is stale. Re-map the current timeline before editing.')
}
export function unscannedDiscoveryRanges(s:ConstructionState):FrameRange[] {
  let holes=s.scope.map(r=>({...r}))
  for(const scan of mergeRanges(s.discoveryScans??[]))
    holes=holes.flatMap(h=>!overlap(scan,h)?[h]:[
      ...(h.start<scan.start?[{start:h.start,end:scan.start}]:[]),
      ...(h.end>scan.end?[{start:scan.end,end:h.end}]:[]),
    ])
  return holes
}
/** An overview receipt proves sampling happened, NOT that the entire interval was
 * closely inspected. Deletion decisions demand focused direct visual evidence. */
export function assertDiscoveryDecisionEvidence(
  s:ConstructionState,
  event:DiscoveryEvent,
  decision:'keep'|'discard'|'uncertain',
  inspectionIds:string[],
) {
  const ids=new Set(inspectionIds)
  const relevant=s.inspections.filter(i=>ids.has(i.id) && i.audio && i.frames.length)
  if(!relevant.some(i=>i.start<=event.start&&i.end>=event.end) &&
     !mergeRanges(relevant).some(r=>r.start<=event.start&&r.end>=event.end))
    throw new Error(`Missing complete audiovisual inspection of candidate ${event.id}; inspect the whole interval before deciding`)
  if(decision!=='discard')return
  const focused=relevant.filter(i=>i.mode==='focused'||i.mode==='boundary')
  if(!mergeRanges(focused).some(r=>r.start<=event.start&&r.end>=event.end))
    throw new Error(`Discarding event ${event.id} requires focused visual inspection across its full range; sparse overview is not enough`)
  const fps=s.fps
  for(const i of focused) {
    const frames=[...i.frames].sort((a,b)=>a-b)
    if(frames[0]!==i.start || frames.at(-1)!==i.end-1)
      throw new Error(`Focused inspection ${i.id} misses its interval edges`)
    if(frames.some((f,index)=>index>0&&f-frames[index-1]>Math.max(2,Math.ceil(fps*.25))))
      throw new Error(`Focused inspection ${i.id} is too sparse to support deletion`)
  }
  const observed=new Set(focused.flatMap(i=>i.frames))
  for(const frame of event.visualFrames)
    if(frame>=event.start&&frame<event.end&&!observed.has(frame))
      throw new Error(`Inspect exact visual trigger frame ${frame} for event ${event.id} before discarding it`)
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
  if(s.sections) {
    const sections=s.sections
    if(sections.context.length>2000||sections.editing.length>12000)throw new Error('Section budget exceeded')
    for(const c of sections.context){
      range.parse(c)
      if(!inside(c,s.scope))throw new Error('Context section escaped original timeline scope')
      if(c.indexed){
        if(!c.summary?.trim()||!c.evidenceIds?.length)throw new Error('Banked context section lacks grounded evidence')
        if(c.evidenceIds.some(id=>!s.inspections.some(i=>i.id===id)))throw new Error('Banked context section uses unknown inspection receipts')
      }
    }
    for(const c of sections.editing){
      range.parse(c)
      if(!inside(c,s.scope)||c.contextIds?.some(id=>!sections.context.some(x=>x.id===id)))
        throw new Error('Edit section escaped original timeline or references unknown bank context')
      if(c.planned && (!c.summary?.trim()||!c.evidenceIds?.length))
        throw new Error('Planned edit section needs grounded reasoning and receipts')
    }
  }
  if(s.discoveryScans?.length) {
    if(s.discoveryScans.length>3000)throw new Error('Discovery scan limit reached')
    for(const scan of s.discoveryScans) {
      range.parse(scan)
      if(!inside(scan,s.scope)||scan.fingerprint!==s.fingerprint)throw new Error('Stale or out-of-scope discovery scan')
    }
  }
  if(s.discoveryEvents?.length) {
    if(s.discoveryEvents.length>10000)throw new Error('Discovery event limit reached')
    const scans=new Set((s.discoveryScans??[]).map(x=>x.id))
    if(new Set(s.discoveryEvents.map(e=>e.id)).size!==s.discoveryEvents.length)throw new Error('Duplicate event ID')
    for(const event of s.discoveryEvents) {
      range.parse(event)
      if(!inside(event,s.scope)||!scans.has(event.scanId))throw new Error('Discovery event lacks a valid source scan')
    }
  }
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
  if(s.sections?.context.some(x=>!x.indexed))
    throw new Error('Bank the complete authorised timeline context before applying any cuts')
  if(s.sections?.editing.some(x=>!x.planned))
    throw new Error('Plan every local editing section with access to the global context bank before applying cuts')
  if(uncoveredRanges(s).length) throw new Error('Investigate missing audiovisual coverage before cutting')
  if((s.discoveryRequired || s.discoveryScans?.length) && unscannedDiscoveryRanges(s).length)
    throw new Error('Complete the original timeline discovery scan before cutting; candidate search is only partially indexed')
  if(!s.beats.length || !s.cuts.length) throw new Error('Map story beats and propose cuts before applying')
  if(p.tracks.some(t=>t.locked && Object.values(p.clips).some(c=>c.trackId===t.id))) throw new Error('Locked tracks could lose sync during ripple cuts; resolve them first')
  if(s.cuts.reduce((n,c)=>n+c.end-c.start,0)>=s.scope.reduce((n,r)=>n+r.end-r.start,0)) throw new Error('Cannot remove the entire video')
  for(const c of s.cuts) {
    for(const event of s.discoveryEvents??[]) {
      if(!overlap(event,c))continue
      if(event.decision==='discard') {
        if(s.discoveryRequired)assertDiscoveryDecisionEvidence(s,event,'discard',event.inspectionIds??[])
        continue
      }
      if(event.decision==='keep')throw new Error(`Cut damages an explicitly protected discovery event ${event.id}: ${event.description}`)
      throw new Error(`Cut intersects unresolved discovery event ${event.id} (${event.signal}); inspect the actual audiovisual moment before deciding`)
    }
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
  const unscanned=(s.discoveryRequired||s.discoveryScans?.length)?unscannedDiscoveryRanges(s):[]
  if(unscanned.length)return {stage:'discover',complete:false,uncovered:unscanned,next:'Finish indexing the original timeline event candidates before proposing removals'}
  if(s.sections?.context.some(x=>!x.indexed))return {
    stage:'context-bank',complete:false,
    uncovered:s.sections.context.filter(x=>!x.indexed).map(x=>({start:x.start,end:x.end})),
    next:'Bank the full authorised recording in evidence-backed sections before planning local edits'
  }
  const uncovered=uncoveredRanges(s)
  if(!uncovered.length && s.sections?.editing.every(x=>x.planned) && s.beats.length)
    return {stage:'assemble',complete:false,uncovered:[],
      next:'Choose original source moments in intentional output order, validate the source-backed EDL, then publish a new non-destructive edit sequence'}
  return {stage:uncovered.length?'investigate':s.beats.length?'refine':'map',complete:false,uncovered,next:uncovered.length?'Inspect uncovered timeline ranges with audio and pictures':s.beats.length?'Refine scene cuts, call inspect_cut_context for each cut, inspect neighbouring frames and validate dialogue boundaries':'Map chapters, scenes, setups, payoffs and their dependencies'}
}
export function nextEventProbe(left:number,right:number,leftPresent:boolean,rightPresent:boolean,singleChange:boolean) {
  range.parse({start:left,end:right})
  if(!singleChange) throw new Error('Scan first: repeating or uncertain events cannot use bisection safely')
  if(leftPresent===rightPresent) throw new Error('The endpoints must bracket a change')
  return {frame:right-left===1?right:Math.floor((left+right)/2),done:right-left===1}
}

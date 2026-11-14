/** Source-backed, non-destructive story assembly for Lumen.
 *
 * Only clips already in the authorised ORIGINAL timeline are eligible.
 * All output clips are copied from a frozen source manifest, never imported
 * from elsewhere. The source->output map makes every editorial decision
 * independently inspectable and allows later repair/rebuild.
 */
import { current, isDraft } from 'immer'
import { uid } from '@/lib/id'
import { cloneClip, clipEnd, splitClip } from './ops'
import { freshName } from './sequences'
import type { Clip, Marker, Project, ProjectSettings, Sequence, Track } from './types'
import type { ConstructionState, FrameRange } from './video-construction'
import { constructionFingerprint, mergeRanges, uncoveredRanges, unscannedDiscoveryRanges } from './video-construction'

export type AssemblyRole='hook'|'setup'|'scene'|'escalation'|'payoff'|'callback'|'ending'|'complete'
export interface SourceSelection extends FrameRange {
  id:string
  role:AssemblyRole
  beatId:string
  reason:string
  evidenceIds:string[]
}
export interface ImmutableSourceManifest {
  fingerprint:string
  sequenceId:string
  settings:ProjectSettings
  tracks:Track[]
  clips:Record<string,Clip>
  markers:Marker[]
}
export interface SourceClipMap {
  selectionId:string
  originalClipId:string
  originalTrackId:string
  outputClipId:string
  outputTrackId:string
  assetId?:string
  nestedSequenceId?:string
  sourceStart:number
  sourceEnd:number
  sourceInPoint:number
  outputStart:number
  outputEnd:number
  outputInPoint:number
}
export interface SelectionOutputMap {
  selectionId:string
  role:AssemblyRole
  beatId:string
  sourceStart:number
  sourceEnd:number
  outputStart:number
  outputEnd:number
}
export interface KeepFirstOutput {
  sequence:Sequence
  selections:SelectionOutputMap[]
  clips:SourceClipMap[]
  joins:number[]
  outputFrames:number
  originalFrames:number
}
export function captureConstructionManifest(p:Project, fingerprint=constructionFingerprint(p)):ImmutableSourceManifest {
  return {
    fingerprint,sequenceId:p.sequence?.id??'seq_main',
    settings:structuredClone(p.settings),tracks:structuredClone(p.tracks),
    clips:structuredClone(p.clips),markers:structuredClone(p.markers)
  }
}
const contains=(outer:FrameRange,inner:FrameRange)=>outer.start<=inner.start&&outer.end>=inner.end
const overlap=(a:FrameRange,b:FrameRange)=>a.start<b.end&&b.start<a.end
const included=(ranges:SourceSelection[],r:FrameRange)=>ranges.some(x=>contains(x,r))
const maxText=(value:string)=>typeof value==='string'&&value.trim().length>0&&value.length<=2000

export function validateKeepFirstSelections(p:Project,s:ConstructionState):SourceSelection[] {
  if(s.applied)throw new Error('Already published; inspect output or explicitly start a new construction pass')
  if(s.paused)throw new Error('Construction is paused')
  const manifest=s.sourceManifest
  if(!manifest)throw new Error('No original-timeline source manifest is available for keep-first assembly')
  if(s.projectId!==p.id || manifest.fingerprint!==s.fingerprint ||
     s.fingerprint!==constructionFingerprint(p) ||
     manifest.sequenceId!==(p.sequence?.id??'seq_main'))
    throw new Error('Original source timeline has changed; rebuild its source manifest before publishing')
  if(s.discoveryRequired&&unscannedDiscoveryRanges(s).length)
    throw new Error('Discover the entire original timeline before assembling selections')
  if(s.sections?.context.some(c=>!c.indexed))
    throw new Error('Complete whole-video context banking before assembling selected footage')
  if(s.sections?.editing.some(c=>!c.planned))
    throw new Error('Plan every local editing section against the complete story context first')
  if(uncoveredRanges(s).length)
    throw new Error('Review audiovisual coverage for the whole original timeline before assembling')
  const items=s.sourceSelections??[]
  if(!items.length)throw new Error('Select the actual retained source moments before constructing output')
  if(items.length>1000)throw new Error('Selection budget exceeded; split construction into a separate sequence')
  const ids=new Set<string>()
  for(const item of items) {
    if(!item.id?.trim()||ids.has(item.id))throw new Error('Duplicate or blank source selection ID')
    ids.add(item.id)
    if(!Number.isSafeInteger(item.start)||!Number.isSafeInteger(item.end)||item.start<0||item.end<=item.start)
      throw new Error(`Invalid selected source frames in ${item.id}`)
    if(!s.scope.some(scope=>contains(scope,item)))
      throw new Error(`Selection ${item.id} would use footage outside the original authorised timeline`)
    const beat=s.beats.find(x=>x.id===item.beatId)
    if(!beat || !overlap(beat,item))
      throw new Error(`Selection ${item.id} has no grounded overlapping story beat`)
    if(!maxText(item.reason))throw new Error(`Selection ${item.id} needs a grounded editing reason`)
    if(!Array.isArray(item.evidenceIds)||!item.evidenceIds.length)
      throw new Error(`Selection ${item.id} needs actual source inspection receipts`)
    const receipts=s.inspections.filter(i=>item.evidenceIds.includes(i.id)&&i.audio&&i.frames.length)
    if(!mergeRanges(receipts).some(r=>contains(r,item)))
      throw new Error(`Selection ${item.id} has not been audiovisually inspected over its entire source range`)
    if(!Object.values(manifest.clips).some(c=>overlap(c,item)))
      throw new Error(`Selection ${item.id} contains no authorised source clips`)
  }
  const first=items[0].role,last=items[items.length-1].role
  if(!['hook','setup','complete'].includes(first)||!['ending','complete'].includes(last))
    throw new Error('The output must have a grounded opening and a meaningful ending')
  // Keep-first: all source-backed moments explicitly marked important must
  // survive intact. Partial overlap can still sever a reaction or joke.
  for(const b of s.beats)for(const essential of b.protectedRanges)
    if(!included(items,essential))throw new Error(`Protected story moment omitted: ${essential.reason}`)
  for(const event of s.discoveryEvents??[]) {
    if(event.decision==='discard')continue
    if(!included(items,event))throw new Error(`Unreviewed or protected discovery event omitted: ${event.id} (${event.signal})`)
  }
  // A callback cannot be placed before its required setup and still count as
  // a coherent output. The model must rewrite links explicitly if intentional.
  const firstOccurrence=new Map<string,number>()
  for(let i=0;i<items.length;i++)
    if(!firstOccurrence.has(items[i].beatId))firstOccurrence.set(items[i].beatId,i)
  for(let i=0;i<items.length;i++){
    const beat=s.beats.find(b=>b.id===items[i].beatId)!
    for(const dependency of beat.dependsOn){
      const earlier=firstOccurrence.get(dependency)
      if(earlier===undefined||earlier>=i)
        throw new Error(`Required setup ${dependency} is absent or follows its dependent ${beat.id}`)
    }
  }
  return items
}
/** Trim an exact subrange of one original clip. We reuse the SAME split maths
 * as manual timeline edits, preserving speed ramps, in-points, keyframes,
 * attached motion and fade behaviour instead of approximating source times. */
function sourceSlice(source:Clip,from:number,to:number,context:Project):Clip {
  const initial=cloneClip(source)
  const work={...context,clips:{[initial.id]:initial}} as Project
  let result=initial
  if(from>result.start) {
    const right=splitClip(work,result,from)
    if(!right)throw new Error('Failed to trim source clip start')
    result=right
  }
  if(to<clipEnd(result)) {
    const discarded=splitClip(work,result,to)
    if(!discarded)throw new Error('Failed to trim source clip end')
  }
  if(result.duration!==to-from)throw new Error('Source slice duration mismatch')
  return result
}
function mainTrackFullyCovered(m:ImmutableSourceManifest,items:SourceSelection[],trackId:string):boolean {
  const clipRanges=Object.values(m.clips).filter(c=>c.trackId===trackId).map(c=>({start:c.start,end:clipEnd(c)}))
  const merged=mergeRanges(clipRanges)
  return items.every(x=>merged.some(r=>contains(r,x)))
}
export function composeKeepFirstSequence(p:Project,s:ConstructionState,name='Lumen assembled video'):KeepFirstOutput {
  const items=validateKeepFirstSelections(p,s)
  const manifest=s.sourceManifest!
  const m=structuredClone(isDraft(manifest)?current(manifest):manifest)
  const trackIds=new Map(m.tracks.map(t=>[t.id,uid('track')]))
  const tracks=m.tracks.map(t=>{
    const copy=structuredClone(t)
    copy.id=trackIds.get(t.id)!
    copy.locked=false
    // A magnetic main track packs away legitimate gaps. Preserve its role
    // only if it fully covers every selected segment; otherwise exact source
    // time alignment across sound/overlays would be corrupted.
    if(copy.role==='main'&&!mainTrackFullyCovered(m,items,t.id))copy.role=undefined
    return copy
  })
  const seq:Sequence={
    id:uid('seq'),name:freshName(p,name),settings:structuredClone(m.settings),
    tracks,clips:{},markers:[],createdAt:Date.now(),
  }
  const map:SourceClipMap[]=[],selectionMap:SelectionOutputMap[]=[],joins:number[]=[]
  let cursor=0
  for(const [i,selection] of items.entries()){
    if(i)joins.push(cursor)
    const duration=selection.end-selection.start
    selectionMap.push({selectionId:selection.id,role:selection.role,beatId:selection.beatId,
      sourceStart:selection.start,sourceEnd:selection.end,outputStart:cursor,outputEnd:cursor+duration})
    const groups=new Map<string,string>()
    for(const source of Object.values(m.clips)){
      const a=Math.max(source.start,selection.start),z=Math.min(clipEnd(source),selection.end)
      if(z<=a)continue
      const clip=sourceSlice(source,a,z,p)
      const originalId=source.id
      const originalTrackId=source.trackId
      clip.id=uid('clip')
      clip.trackId=trackIds.get(source.trackId)!
      clip.start=cursor+(a-selection.start)
      if(clip.groupId){
        const g=groups.get(clip.groupId)??uid('grp')
        groups.set(clip.groupId,g)
        clip.groupId=g
      }
      // A transition from outside this selected source span would have no
      // actual preceding scene in the new edit. Do not invent a dissolve.
      if(a===selection.start)clip.transitionIn=null
      seq.clips[clip.id]=clip
      map.push({
        selectionId:selection.id,originalClipId:originalId,originalTrackId,
        outputClipId:clip.id,outputTrackId:clip.trackId,
        ...(source.assetId?{assetId:source.assetId}:{}),
        ...(source.sequenceId?{nestedSequenceId:source.sequenceId}:{}),
        sourceStart:a,sourceEnd:z,sourceInPoint:source.inPoint,
        outputStart:clip.start,outputEnd:clipEnd(clip),outputInPoint:clip.inPoint,
      })
    }
    for(const marker of m.markers.filter(x=>x.frame>=selection.start&&x.frame<selection.end))
      seq.markers.push({...structuredClone(marker),id:uid('mk'),frame:cursor+marker.frame-selection.start})
    cursor+=duration
  }
  if(!map.length)throw new Error('No source clips were assembled')
  return {sequence:seq,selections:selectionMap,clips:map,joins,
    outputFrames:cursor,originalFrames:s.scope.reduce((n,r)=>n+r.end-r.start,0)}
}
/** A source-map proves placement and identity, not semantic correctness. */
export function validateOutputSourceMap(output:KeepFirstOutput,m:ImmutableSourceManifest) {
  for(const region of output.selections){
    if(region.outputEnd-region.outputStart!==region.sourceEnd-region.sourceStart)
      throw new Error('Source-to-output selection duration mismatch')
  }
  for(const item of output.clips){
    const src=m.clips[item.originalClipId],render=output.sequence.clips[item.outputClipId]
    if(!src||!render||render.trackId!==item.outputTrackId ||
       src.trackId!==item.originalTrackId ||
       render.start!==item.outputStart||clipEnd(render)!==item.outputEnd ||
       item.sourceEnd-item.sourceStart!==render.duration ||
       src.assetId!==item.assetId || src.sequenceId!==item.nestedSequenceId)
      throw new Error('Assembled clip lacks an exact authorised source identity')
    const selection=output.selections.find(x=>x.selectionId===item.selectionId)
    if(!selection ||item.sourceStart<selection.sourceStart||item.sourceEnd>selection.sourceEnd||
      item.outputStart!==selection.outputStart+item.sourceStart-selection.sourceStart)
      throw new Error('Source-to-output clip mapping drifted')
  }
}

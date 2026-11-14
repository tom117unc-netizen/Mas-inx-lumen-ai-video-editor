/** A signal is a place to look. This ledger records what an inspector
 * actually perceived after examining ORIGINAL footage, preserving unknowns.
 * No visual difference, loudness score or web research may create a finding.
 */
import type { ConstructionState, DiscoveryEvent, FrameRange, InspectionReceipt } from './video-construction'
import { mergeRanges } from './video-construction'

export type ObservedEventKind=
  'unknown'|'speech'|'gameplay'|'challenge-rule'|'round-transition'|
  'reaction'|'laughter'|'joke'|'music'|'game-sound'|'scene-change'|'background'
export interface ConstructionEventFinding {
  eventId:string
  kind:ObservedEventKind
  summary:string
  confidence:'observed'|'uncertain'
  inspectionIds:string[]
  audioObservationIds:string[]
  linkedMomentIds:string[]
  uncertainty:string
}
const hasCoverage=(receipts:FrameRange[],range:FrameRange)=>
  mergeRanges(receipts).some(r=>r.start<=range.start&&r.end>=range.end)
const isAudioMeaning=(kind:ObservedEventKind)=>
  ['reaction','laughter','joke','music','game-sound'].includes(kind)

/** Pure evidence gate. A focus receipt is still sampled, not guaranteed to
 * capture everything between frames. Audio claims must cite a recorded heard
 * observation and the original captured sample range; numeric RMS is not sound
 * interpretation. */
export function validateConstructionEventFinding(
  s:ConstructionState,f:ConstructionEventFinding,
):DiscoveryEvent {
  const event=s.discoveryEvents?.find(e=>e.id===f.eventId)
  if(!event)throw new Error('Interpretation refers to an unknown discovery event')
  if(typeof f.summary!=='string'||f.summary.trim().length<20||f.summary.length>1500)
    throw new Error('Event finding requires a concrete, source-grounded description')
  if(f.uncertainty.length>1200)throw new Error('Uncertainty note is too long')
  if(!f.inspectionIds.length||f.inspectionIds.length>30 ||
     !Array.isArray(f.audioObservationIds)||f.audioObservationIds.length>12)
    throw new Error('Event finding needs bounded audiovisual inspection evidence')
  if(f.linkedMomentIds.length>20||new Set(f.linkedMomentIds).size!==f.linkedMomentIds.length)
    throw new Error('Invalid referenced story moments')
  const receipts:InspectionReceipt[]=s.inspections.filter(i=>f.inspectionIds.includes(i.id)&&i.audio&&i.frames.length)
  if(!hasCoverage(receipts,event))
    throw new Error(`Event ${event.id} must have inspected audiovisual evidence covering its complete original range`)
  const focused=receipts.filter(i=>i.mode==='focused'||i.mode==='boundary')
  const meaningRequiresFocus=f.kind!=='unknown'&&f.kind!=='speech'&&f.kind!=='background'
  if(f.confidence==='observed'&&meaningRequiresFocus){
    if(!hasCoverage(focused,event))
      throw new Error(`Semantic event ${event.id} needs focused or frame-by-frame visual inspection, not a sparse overview`)
    const actualFrames=new Set(focused.flatMap(i=>i.frames))
    for(const frame of event.visualFrames)
      if(frame>=event.start&&frame<event.end&&!actualFrames.has(frame))
        throw new Error(`Semantic event ${event.id} missed exact sampled visual trigger frame ${frame}`)
  }
  if(f.confidence==='observed'&&isAudioMeaning(f.kind)&&!f.audioObservationIds.length)
    throw new Error(`Sound/delivery-dependent event ${event.id} requires a recorded real-audio listening observation or must remain uncertain`)
  for(const id of f.audioObservationIds){
    const observation=s.audioObservations?.find(x=>x.id===id)
    const sample=observation && s.audioSamples?.find(x=>x.id===observation.sampleId&&x.fingerprint===s.fingerprint)
    if(!sample || !observation || sample.start>event.start||sample.end<event.end)
      throw new Error(`Audio finding ${id} does not cover the entire original event or has stale source identity`)
    if(observation.confidence==='low'&&f.confidence==='observed'&&isAudioMeaning(f.kind))
      throw new Error('A low-confidence audio interpretation cannot justify confident sound semantics')
  }
  for(const moment of f.linkedMomentIds){
    if(!s.narrativeMoments?.some(x=>x.id===moment))
      throw new Error(`Finding references unknown narrative moment ${moment}`)
  }
  if(f.confidence==='uncertain'&&!f.uncertainty.trim())
    throw new Error('An unresolved event must state what remains unknown')
  return event
}
export function pendingEventInvestigations(s:ConstructionState,max=20) {
  const seen=new Set((s.eventFindings??[]).map(x=>x.eventId))
  return (s.discoveryEvents??[])
    .filter(e=>!seen.has(e.id)&&e.decision!=='discard')
    .sort((a,b)=>b.strength-a.strength||a.start-b.start)
    .slice(0,max)
}

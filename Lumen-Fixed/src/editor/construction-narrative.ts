/** Explicit source-grounded narrative memory for long game recordings.
 * Unlike a prose summary, required plot points and causal dependencies can
 * be mechanically checked against the ORDERED output EDL. Significance still
 * depends on genuine audiovisual interpretation; never infer it from RMS.
 */
import type { ConstructionState } from './video-construction'
import type { SourceSelection } from './construction-assembler'

export type NarrativeKind=
  'premise'|'rule'|'round-start'|'round-end'|'objective'|'discovery'|
  'joke-setup'|'joke-payoff'|'callback'|'reaction'|'failure'|'success'|'ending'|'other'
export interface NarrativeLink {momentId:string;relation:'requires'|'answers'|'consequence'|'callback'}
export interface NarrativeMoment {
  id:string;start:number;end:number;kind:NarrativeKind;description:string
  importance:'essential'|'supporting'|'optional'
  confidence:'observed'|'uncertain'
  evidenceIds:string[]
  links:NarrativeLink[]
}
export interface MappedNarrativeMoment {
  momentId:string;kind:NarrativeKind;sourceStart:number;sourceEnd:number
  selectionId:string;outputStart:number;outputEnd:number
}
const contained=(outer:{start:number;end:number},inner:{start:number;end:number})=>
  outer.start<=inner.start&&outer.end>=inner.end
/** Validate one moment's provenance before it can influence editorial decisions. */
export function validateNarrativeMoment(s:ConstructionState,m:NarrativeMoment) {
  if(!m.id?.trim()||m.id.length>128||
     !Number.isSafeInteger(m.start)||!Number.isSafeInteger(m.end)||m.start<0||m.end<=m.start)
    throw new Error('Narrative moment has an invalid ID or source frame range')
  if(!s.scope.some(r=>contained(r,m)))throw new Error(`Narrative moment ${m.id} escapes authorised source timeline`)
  if(!m.description?.trim()||m.description.length>2000)
    throw new Error(`Narrative moment ${m.id} requires an actual source-backed description`)
  if(!m.evidenceIds?.length)throw new Error(`Narrative moment ${m.id} lacks evidence`)
  const receipts=s.inspections.filter(i=>m.evidenceIds.includes(i.id)&&i.audio&&i.frames.length)
  if(!receipts.some(i=>contained(i,m))&&
     !merged(receipts).some(i=>contained(i,m)))
    throw new Error(`Narrative moment ${m.id} is not covered by real source audiovisual inspection`)
  if(m.confidence==='uncertain'&&m.importance==='essential')
    throw new Error(`Essential moment ${m.id} remains uncertain; inspect before promoting it to required`)
  if(new Set(m.links.map(x=>x.momentId)).size!==m.links.length)
    throw new Error(`Narrative moment ${m.id} repeats the same linked moment`)
  if(m.links.some(x=>x.momentId===m.id))
    throw new Error(`Narrative moment ${m.id} cannot depend on itself`)
}
function merged(receipts:{start:number;end:number}[]){
 const out:{start:number;end:number}[]=[]
 for(const r of [...receipts].sort((a,b)=>a.start-b.start)){
  const last=out.at(-1)
  if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end)
  else out.push({start:r.start,end:r.end})
 }
 return out
}
/** Build the source-backed occurrence graph; the same important moment may
 * appear in a hook and again when the full payoff arrives later. */
export function mapNarrativeMoments(s:ConstructionState,selections:SourceSelection[]):MappedNarrativeMoment[]{
 let cursor=0
 const mapped:MappedNarrativeMoment[]=[]
 for(const sel of selections){
  for(const moment of s.narrativeMoments??[]){
   if(contained(sel,moment))mapped.push({
    momentId:moment.id,kind:moment.kind,selectionId:sel.id,
    sourceStart:moment.start,sourceEnd:moment.end,
    outputStart:cursor+moment.start-sel.start,outputEnd:cursor+moment.end-sel.start,
   })
  }
  cursor+=sel.end-sel.start
 }
 return mapped
}
/** Every explicitly essential moment survives; every required setup can be
 * found before its FINAL relevant payoff, not merely hidden in an opening hook. */
export function validateNarrativeStory(s:ConstructionState,selections:SourceSelection[]){
 const moments=s.narrativeMoments??[]
 if(moments.length>2500)throw new Error('Narrative ledger budget exceeded')
 if(new Set(moments.map(x=>x.id)).size!==moments.length)throw new Error('Duplicate narrative moment IDs')
 for(const m of moments)validateNarrativeMoment(s,m)
 const map=mapNarrativeMoments(s,selections)
 const byId=new Map(moments.map(m=>[m.id,m]))
 for(const m of moments) {
  const occurrences=map.filter(x=>x.momentId===m.id)
  if(m.importance==='essential'&&!occurrences.length)
   throw new Error(`Essential source moment ${m.id} was omitted from the assembled video: ${m.description}`)
  for(const link of m.links) {
   const required=byId.get(link.momentId)
   if(!required)throw new Error(`Unresolved narrative relationship: ${m.id} -> ${link.momentId}`)
   if(!occurrences.length)continue
   const before=map.filter(x=>x.momentId===required.id)
   if(!before.length)
    throw new Error(`Moment ${m.id} lost its necessary context ${required.id}`)
   const after=occurrences.filter(x=>selections.find(sel=>sel.id===x.selectionId)?.role!=='hook')
   const obeys=after.some(current=>before.some(context=>context.outputEnd<=current.outputStart))
   if((link.relation==='requires'||link.relation==='answers'||link.relation==='callback')&&!obeys)
    throw new Error(`Moment ${m.id} must follow its actual ${link.relation} context ${required.id} in the finished narrative`)
  }
 }
 for(const m of moments.filter(m=>m.importance==='essential' &&
   ['round-end','joke-payoff','callback'].includes(m.kind))){
  if(!m.links.length)
   throw new Error(`Essential ${m.kind} ${m.id} has no explicit linked beginning/setup; verify continuity`)
 }
 return map
}

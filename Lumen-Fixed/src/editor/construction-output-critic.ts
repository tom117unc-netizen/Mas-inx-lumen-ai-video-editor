/** A skeptical, deterministic audit of the ACTUAL published editorial story.
 *
 * This does not understand jokes or gameplay. It verifies that the independent
 * post-output inspection has revisited essential source-grounded moments, and
 * that round and setup/payoff promises survive in the assembled output order.
 * A model saying "the video flows well" cannot bypass these checks.
 */
import type {ConstructionState, InspectionReceipt} from './video-construction'
import type {MappedNarrativeMoment, NarrativeMoment} from './construction-narrative'
import type {SelectionOutputMap} from './construction-assembler'

export interface OutputNarrativeAudit {
  available:boolean
  ok:boolean
  issues:string[]
  checkedEssentialMoments:number
  outputVerifiedMoments:number
  inspectedOutputFrames:number
  limitations:string
}
const limitation='This audit proves saved source-to-output timing, key-moment presence and real inspection calls; it does NOT prove the reviewer heard or understood the video. An independent audiovisual viewing pass and human acceptance remain necessary.'
const contains=(outer:{start:number;end:number},inner:{start:number;end:number})=>
  outer.start<=inner.start&&outer.end>=inner.end
function union(ranges:{start:number;end:number}[]){
  const out:{start:number;end:number}[]=[]
  for(const r of [...ranges].sort((a,b)=>a.start-b.start)){
    const last=out.at(-1)
    if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end)
    else out.push({...r})
  }
  return out
}
function inspected(m:MappedNarrativeMoment,receipts:InspectionReceipt[]){
  const valid=receipts.filter(r=>r.audio&&r.frames.length&&
    r.start<m.outputEnd&&r.end>m.outputStart)
  const targeted=valid.filter(r=>r.mode==='focused'||r.mode==='boundary')
  return union(valid).some(r=>contains(r,{start:m.outputStart,end:m.outputEnd})) &&
    targeted.some(r=>r.frames.some(f=>f>=m.outputStart&&f<m.outputEnd))
}
export function auditOutputNarrative(s:ConstructionState):OutputNarrativeAudit {
  const issues:string[]=[]
  const output=s.assembly
  if(!s.applied||!output)return {available:false,ok:false,
    issues:['Publish an assembled video before auditing its output story'],
    checkedEssentialMoments:0,outputVerifiedMoments:0,inspectedOutputFrames:0,limitations:limitation}

  const all=s.narrativeMoments??[]
  const mappings=output.moments??[]
  const regions=output.selections??[]
  const receipts=s.inspections??[]
  const byId=new Map<string,NarrativeMoment>()
  const selections=new Map<string,SelectionOutputMap>()
  for(const section of regions){
    if(selections.has(section.selectionId))issues.push('Duplicate final section ID: '+section.selectionId)
    selections.set(section.selectionId,section)
  }
  for(const moment of all){
    if(byId.has(moment.id))issues.push('Duplicate source narrative ID: '+moment.id)
    byId.set(moment.id,moment)
  }
  // No free-form model account may certify a rearranged story lacking
  // any source-backed event inventory. A single untouched complete selection
  // is still allowed for no-edit/diagnostic workflows.
  if(!all.length&&(regions.length!==1||regions[0]?.role!=='complete'))
    issues.push('Reconstructed video has no source-grounded narrative moment ledger to verify')

  const occurrences=new Map<string,MappedNarrativeMoment[]>()
  for(const occurrence of mappings){
    const source=byId.get(occurrence.momentId)
    const section=selections.get(occurrence.selectionId)
    if(!source || !section){
      issues.push('Output narrative references unknown source moment or section: '+occurrence.momentId)
      continue
    }
    if(occurrence.kind!==source.kind||
       occurrence.sourceStart!==source.start||occurrence.sourceEnd!==source.end||
       !contains({start:section.sourceStart,end:section.sourceEnd},
         {start:source.start,end:source.end}) ||
       occurrence.outputStart!==section.outputStart+source.start-section.sourceStart||
       occurrence.outputEnd!==occurrence.outputStart+source.end-source.start||
       occurrence.outputEnd>section.outputEnd)
      issues.push('Output narrative mapping is inconsistent with original source: '+source.id)
    const list=occurrences.get(occurrence.momentId)??[]
    list.push(occurrence);occurrences.set(occurrence.momentId,list)
  }
  const nonHook=(id:string)=> (occurrences.get(id)??[])
    .filter(m=>selections.get(m.selectionId)?.role!=='hook')
    .sort((a,b)=>a.outputStart-b.outputStart)
  let essentials=0,verified=0
  for(const moment of all){
    if(moment.importance!=='essential')continue
    essentials++
    const visible=nonHook(moment.id)
    if(!visible.length){
      issues.push('Required '+moment.kind+' is absent outside the teaser/hook: '+moment.id)
      continue
    }
    if(!visible.some(m=>inspected(m,receipts)))
      issues.push('Required '+moment.kind+' needs focused re-inspection in the ACTUAL edited output: '+moment.id)
    else verified++
    for(const link of moment.links){
      if(!['requires','answers','callback','consequence'].includes(link.relation))continue
      const context=nonHook(link.momentId)
      if(!context.some(before=>visible.some(after=>before.outputEnd<=after.outputStart)))
        issues.push('Final output lost earlier '+link.relation+' context '+link.momentId+' for '+moment.id)
    }
  }
  const requiredRules=all.filter(m=>m.importance==='essential'&&['rule','premise'].includes(m.kind))
  const starts=all.filter(m=>m.kind==='round-start'&&m.importance==='essential')
  const ends=all.filter(m=>m.kind==='round-end'&&m.importance==='essential')
  for(const start of starts){
    const opening=nonHook(start.id)[0]
    if(!opening)continue
    for(const rule of requiredRules){
      if(!nonHook(rule.id).some(m=>m.outputEnd<=opening.outputStart))
        issues.push('Challenge rule/premise '+rule.id+' is missing before round '+start.id)
    }
    if(!ends.some(end=>end.links.some(link=>link.momentId===start.id)&&
       nonHook(end.id).some(outcome=>outcome.outputStart>=opening.outputEnd)))
      issues.push('Round '+start.id+' lacks a linked later outcome in the finished video')
  }
  for(const end of ends){
    if(!end.links.some(link=>byId.get(link.momentId)?.kind==='round-start'))
      issues.push('Round outcome '+end.id+' does not identify its actual round beginning')
  }
  for(const moment of all.filter(m=>m.importance==='essential'&&
    ['joke-payoff','callback'].includes(m.kind))){
    if(!moment.links.some(link=>['joke-setup','discovery','reaction','rule','premise','other']
      .includes(byId.get(link.momentId)?.kind??'')))
      issues.push('Payoff/callback '+moment.id+' lacks a grounded matching setup in the story ledger')
  }
  for(const ending of all.filter(m=>m.kind==='ending'&&m.importance==='essential')){
    if(!nonHook(ending.id).some(m=>['ending','complete'].includes(selections.get(m.selectionId)?.role??'')))
      issues.push('Essential finale '+ending.id+' is not in the concluding output section')
  }
  const observed=union(receipts.filter(r=>r.audio&&r.frames.length))
  const inspectedOutputFrames=observed.reduce((n,r)=>n+r.end-r.start,0)
  return {available:true,ok:issues.length===0,issues,checkedEssentialMoments:essentials,
    outputVerifiedMoments:verified,inspectedOutputFrames,limitations:limitation}
}

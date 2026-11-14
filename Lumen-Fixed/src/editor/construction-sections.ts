/** A timeline-sized, two-pass section scheduler.
 * The context pass maps ALL authorised timeline footage first; the editing pass
 * receives a narrow local working span plus indexed global context on demand.
 * Section boundaries do not themselves approve any edits.
 */
export interface SectionRange {start:number;end:number}
export interface SectionHint extends SectionRange {kind?:string;strength?:number}
export interface PlannedSection extends SectionRange {id:string;contextIds?:string[]}
export interface SectionPlan {totalFrames:number;totalSeconds:number;contextTargetFrames:number;editTargetFrames:number;
  context:PlannedSection[];editing:PlannedSection[]}

const validRange=(x:SectionRange)=>Number.isSafeInteger(x.start)&&Number.isSafeInteger(x.end)&&x.start>=0&&x.end>x.start
const clamp=(x:number,min:number,max:number)=>Math.max(min,Math.min(x,max))

/** Long streams use fewer, larger analysis sections and modest editing windows.
 * Short clips use fine sections, but never generate sub-second work units. */
export function sectionTargets(totalSeconds:number,fps:number) {
  if(!Number.isFinite(totalSeconds)||totalSeconds<=0||!Number.isFinite(fps)||fps<=0)
    throw new Error('Invalid footage duration or frame rate')
  const contextSeconds=totalSeconds<=600?90:totalSeconds<=3600?180:totalSeconds<=10800?300:480
  const editSeconds=totalSeconds<=600?30:totalSeconds<=3600?60:totalSeconds<=10800?90:120
  return {contextTargetFrames:Math.max(1,Math.round(fps*contextSeconds)),
    editTargetFrames:Math.max(1,Math.round(fps*editSeconds))}
}
function splitRanges(scope:SectionRange[],target:number,hints:SectionHint[],prefix:string):PlannedSection[] {
  const out:PlannedSection[]=[]
  for(const r of scope) {
    let position=r.start
    while(position<r.end) {
      const remaining=r.end-position
      let at=Math.min(r.end,position+target)
      if(remaining>target && remaining<target*1.5)at=r.end
      if(at<r.end) {
        const lower=Math.max(position+1,Math.round(position+target*.70))
        const upper=Math.min(r.end-1,Math.round(position+target*1.30))
        const possible=hints.filter(h=>h.start>=position && h.end<=r.end && validRange(h))
          .flatMap(h=>[h.start,h.end].map(frame=>({frame,
            score:(h.kind==='clip-boundary'?5:h.kind==='chapter'?4:h.kind==='audio-drop'?3:2)*
              (h.strength??.5)-Math.abs(frame-at)/target})))
          .filter(h=>h.frame>=lower && h.frame<=upper &&
            !hints.some(ev=>ev.start<h.frame && ev.end>h.frame && ev.kind!=='clip-boundary'))
          .sort((a,b)=>b.score-a.score)
        if(possible[0])at=possible[0].frame
      }
      if(at<=position)throw new Error('Section scheduler did not advance')
      out.push({id:`${prefix}-${out.length+1}`,start:position,end:at})
      position=at
    }
  }
  return out
}
/** Section plans are cheap metadata and do not require an AI request per file.
 * Source scope is hard-bounded to ranges that were already authorised at begin. */
export function planConstructionSections(
  scope:SectionRange[],fps:number,hints:SectionHint[]=[],
):SectionPlan {
  if(!scope.length || scope.some(r=>!validRange(r)))throw new Error('Invalid authorised timeline scope')
  const ordered=[...scope].sort((a,b)=>a.start-b.start)
  for(let i=1;i<ordered.length;i++)if(ordered[i].start<ordered[i-1].end)
    throw new Error('Overlapping permitted ranges')
  const totalFrames=ordered.reduce((n,r)=>n+r.end-r.start,0)
  const totalSeconds=totalFrames/fps
  const {contextTargetFrames,editTargetFrames}=sectionTargets(totalSeconds,fps)
  const context=splitRanges(ordered,contextTargetFrames,hints,'context')
  const editing=splitRanges(ordered,editTargetFrames,hints,'edit').map(x=>({
    ...x,contextIds:context.filter(c=>c.start<x.end&&x.start<c.end).map(c=>c.id),
  }))
  if(context.length>2000||editing.length>12000)throw new Error('Footage exceeds section scheduling budget; split the timeline into authorised sequences')
  return {totalFrames,totalSeconds,contextTargetFrames,editTargetFrames,context,editing}
}
/** Find the first uninspected part of one bank section. Existing receipts are
 * measured, not continuous observation; this is a scheduling aid only.
 * Always account for all receipts, not just the first paginated status page. */
export function nextContextInspectionProbe(
  section:SectionRange,inspected:SectionRange[],maxFrames:number,
):SectionRange|null {
  if(!validRange(section)||!Number.isSafeInteger(maxFrames)||maxFrames<1)
    throw new Error('Invalid context inspection probe')
  const covered=inspected.filter(validRange).map(r=>({
    start:Math.max(section.start,r.start),end:Math.min(section.end,r.end)
  })).filter(validRange).sort((a,b)=>a.start-b.start)
  let cursor=section.start
  for(const r of covered){
    if(r.start>cursor) return {start:cursor,end:Math.min(r.start,cursor+maxFrames)}
    cursor=Math.max(cursor,r.end)
    if(cursor>=section.end)return null
  }
  return cursor<section.end?{start:cursor,end:Math.min(section.end,cursor+maxFrames)}:null
}
export interface BankedSection extends PlannedSection {
  summary?:string;keyMoments?:string[];evidenceIds?:string[];uncertainties?:string[];indexed?:boolean
}
export function pendingContextSections(context:BankedSection[]):BankedSection[]{
  return context.filter(x=>!x.indexed)
}
export interface ContextMatch {section:BankedSection;score:number;reason:'local'|'linked'|'search'|'global'}
const words=(s:string)=>new Set((s.toLowerCase().match(/[a-z0-9]{3,}/g)??[])
  .filter(x=>!['and','the','for','with','this','that','from','into','then','were','have','said','scene','round','video','section'].includes(x)))
/** Query ALL saved section summaries, but return a bounded, purpose-specific
 * evidence pack, not a full-stream transcript. Explicit linked sections and
 * chronological neighbours survive even without transcript keyword matches. */
export function selectBankContext(
  context:BankedSection[],working:SectionRange,query:string,linkedIds:string[]=[],maxItems=8,
):ContextMatch[]{
  if(!validRange(working))throw new Error('Invalid requested editing range')
  const wanted=words(query)
  const linked=new Set(linkedIds)
  const scored=context.filter(x=>x.indexed).map(x=>{
    const local=x.start<working.end&&working.start<x.end
    const linkedMatch=linked.has(x.id)
    const indexed=words([x.summary??'',...(x.keyMoments??[])].join(' '))
    let matched=0
    for(const token of wanted)if(indexed.has(token))matched++
    const relevance=wanted.size?matched/wanted.size:0
    const distance=x.end<working.start?working.start-x.end:x.start>working.end?x.start-working.end:0
    const score=(local?200:0)+(linkedMatch?150:0)+relevance*100+1/(1+distance/Math.max(1,working.end-working.start))
    const reason=local?'local':linkedMatch?'linked':matched?'search':'global'
    return {section:x,score,reason} as ContextMatch
  }).sort((a,b)=>b.score-a.score||a.section.start-b.section.start)
  const take=clamp(Math.floor(maxItems),1,32)
  return scored.slice(0,take)
}

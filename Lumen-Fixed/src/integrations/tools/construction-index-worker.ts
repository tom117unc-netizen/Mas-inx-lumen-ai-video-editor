/** Resumable LOCAL discovery orchestration.
 *
 * Deterministic rendering and low-level signal indexing run in the editor,
 * independently of provider request windows. An explicit start is required.
 * The existing scan_construction_events tool is the single source of truth for
 * original-timeline permissions, analysis and durable per-chunk checkpoints.
 *
 * State in this module is only an in-process job controller; scan coverage and
 * candidates are persisted inside the project after EACH completed chunk.
 * Relaunching the app can resume from the saved holes, never from this cache.
 */
import type { ConstructionState, FrameRange } from '@/editor/video-construction'
import { constructionFingerprint, mergeRanges, unscannedDiscoveryRanges } from '@/editor/video-construction'
import { getProject } from '@/editor/store'

export type IndexRunState='idle'|'running'|'pausing'|'paused'|'completed'|'failed'|'stale'
export interface IndexProgress {
  state:IndexRunState
  jobId:string|null
  indexedFrames:number
  totalFrames:number
  remainingFrames:number
  percent:number
  scans:number
  candidateEvents:number
  nextRange:FrameRange|null
  error?:string
}
interface LiveJob {
  id:string
  projectId:string
  fingerprint:string
  state:IndexRunState
  cancelRequested:boolean
  error?:string
  maxFrames:number
  attempted: number
}
let current:LiveJob|null=null
let jobCounter=0

/** This is a pure planning function; it never loses gaps between authorised
 * timeline ranges and never proposes to revisit a saved completed scan. */
export function nextIndexChunk(s:ConstructionState,maxFrames=Math.max(1,Math.round(s.fps*60))):FrameRange|null{
  if(!Number.isSafeInteger(maxFrames)||maxFrames<1)throw new Error('Invalid index chunk budget')
  const next=unscannedDiscoveryRanges(s)[0]
  return next?{start:next.start,end:Math.min(next.end,next.start+maxFrames)}:null
}
export function indexCoverage(s:ConstructionState) {
  const total=s.scope.reduce((n,r)=>n+r.end-r.start,0)
  const visited=mergeRanges(s.discoveryScans??[])
  let done=0
  for(const scope of s.scope)for(const r of visited){
    done+=Math.max(0,Math.min(scope.end,r.end)-Math.max(scope.start,r.start))
  }
  return {total,done,remaining:Math.max(0,total-done),
    percent:total?Math.round(done/total*1000)/10:100}
}
const statusFor=(s:ConstructionState,job:LiveJob|null):IndexProgress=>{
  const {total,done,remaining,percent}=indexCoverage(s)
  const nextRange=nextIndexChunk(s)
  return {
    state:job?.state??(remaining?'idle':'completed'),
    jobId:job?.id??null,
    indexedFrames:done,totalFrames:total,remainingFrames:remaining,percent,
    scans:s.discoveryScans?.length??0,candidateEvents:s.discoveryEvents?.length??0,
    nextRange,...(job?.error?{error:job.error}:{}),
  }
}
export function constructionIndexProgress(s:ConstructionState):IndexProgress {
  const p=getProject()
  // The output editor opens a NEW sequence after source indexing completes.
  // Its fingerprint intentionally differs from the original. Do not let the
  // retired original job make output review or later source-based repair stale.
  const job=current&&current.projectId===s.projectId&&
    current.fingerprint===s.fingerprint&&!s.applied?current:null
  if(job && (job.fingerprint!==s.fingerprint ||
     constructionFingerprint(p)!==job.fingerprint ||p.construction!==s))
    return {...statusFor(s,job),state:'stale',error:'Original timeline or construction changed; the indexing job cannot use stale source'}
  return statusFor(s,job)
}
/** Called ONLY by an explicit editor tool action. The returned promise does not
 * wait for multi-hour media analysis, so no model request stays open. */
export function startConstructionIndexJob(
  s:ConstructionState,
  scan:(from:number,to:number)=>Promise<{candidates?:unknown[]}>,
):IndexProgress{
  const p=getProject()
  if(p.construction!==s||constructionFingerprint(p)!==s.fingerprint)
    throw new Error('Indexing requires the current unchanged original timeline')
  if(s.paused||s.applied)throw new Error('Resume original construction before indexing')
  if(current&&(current.state==='running'||current.state==='pausing')){
    if(current.projectId===s.projectId&&current.fingerprint===s.fingerprint)
      return constructionIndexProgress(s)
    throw new Error('A different construction indexing job is already active')
  }
  if(!nextIndexChunk(s)){
    current=null
    return statusFor(s,null)
  }
  const job:LiveJob={id:`construction-index-${++jobCounter}`,projectId:s.projectId,
    fingerprint:s.fingerprint,state:'running',cancelRequested:false,
    maxFrames:Math.max(1,Math.round(s.fps*60)),attempted:0}
  current=job
  // No unhandled rejections: a failed chunk leaves the last saved checkpoint.
  void run(job,scan).catch(err=>{
    job.state='failed'
    job.error=err instanceof Error?err.message:String(err)
  })
  return statusFor(s,job)
}
async function run(job:LiveJob,scan:(from:number,to:number)=>Promise<{candidates?:unknown[]}>) {
  while(!job.cancelRequested) {
    // Yield to playback/UI/event handling. Deterministic media scanning can
    // be CPU-heavy, but the provider does not need to wait for the operation.
    await new Promise<void>(resolve=>setTimeout(resolve,0))
    if(job.cancelRequested)break
    const p=getProject(),s=p.construction
    if(!s||p.id!==job.projectId||s.fingerprint!==job.fingerprint||
       constructionFingerprint(p)!==job.fingerprint){
      job.state='stale'
      job.error='Original footage or active project changed during indexing'
      return
    }
    if(s.paused||s.applied){job.state='paused';return}
    const range=nextIndexChunk(s,job.maxFrames)
    if(!range){job.state='completed';return}
    try{
      const result=await scan(range.start,range.end)
      if(job.cancelRequested)break
      // Vary *future* chunk size with real measured density; no length claim
      // is based on media the job has not yet examined.
      const events=result.candidates?.length??0
      job.maxFrames=events>=250?Math.max(1,Math.round(job.maxFrames/2)):
        events<=50?Math.min(Math.round(s.fps*60),Math.max(1,Math.round(job.maxFrames*1.5))):job.maxFrames
      job.attempted=0
    }catch(error){
      if(job.cancelRequested){job.state='paused';return}
      const msg=error instanceof Error?error.message:String(error)
      const canSplit=/found \d+ distinct candidate events|split it into smaller/i.test(msg)
      if(canSplit&&job.maxFrames>Math.max(1,Math.round(s.fps))){
        job.maxFrames=Math.max(1,Math.floor(job.maxFrames/2))
        if(++job.attempted<=10)continue
      }
      // If the project was changed or another tool saved while this chunk was
      // running, fail visibly. Never overwrite another editor decision.
      job.state='failed'
      job.error=msg.slice(0,700)
      return
    }
  }
  job.state='paused'
}
export function pauseConstructionIndexJob():IndexRunState {
  if(!current)return 'idle'
  if(current.state==='running'){current.cancelRequested=true;current.state='pausing'}
  return current.state
}
/** Test-only reset; does not cancel in-flight media rendering. */
export function clearFinishedConstructionIndexJob(){
  if(current&&['completed','paused','failed','stale'].includes(current.state))current=null
}

/** Durable, bounded model turn planning for long editorial work.
 *
 * This does NOT make provider calls immune to timeout. It avoids relying on a
 * single giant call: each unit is small and its project-state checkpoint is
 * the only authority for the next unit. No unbounded retries.
 */
export const CONSTRUCTION_MICRO_STEPS=7
export const CONSTRUCTION_MAX_BATCHES=96
export const CONSTRUCTION_REQUEST_DEADLINE_MS=180_000
export const CONSTRUCTION_MAX_TRANSIENT_RETRIES=3

interface ShortRange {start:number;end:number}
interface Snapshot {
  goal?:unknown;revision?:unknown;fps?:unknown
  status?:{stage?:unknown;complete?:unknown;uncovered?:unknown;uncovered_count?:unknown;next?:unknown}
  missing_timeline_transcripts?:unknown
  discoveryPending?:unknown
  beats?:{total?:unknown};cuts?:{total?:unknown}
  discoveryScans?:{total?:unknown};discoveryEvents?:{total?:unknown}
  inspections?:{total?:unknown};joinAudioChecks?:{total?:unknown}
  applied?:unknown;review?:unknown
}
const safeRange=(value:unknown):ShortRange|null=>{
  if(!value||typeof value!=='object')return null
  const r=value as Partial<ShortRange>
  const start=r.start, end=r.end
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end!<=start!)return null
  return {start:start!,end:end!}
}
function stageOf(snapshot:Snapshot) {
  const stage=snapshot.status?.stage
  return typeof stage==='string'?stage:'unknown'
}
function count(value:unknown) {return Number.isSafeInteger(value)&&Number(value)>=0?Number(value):0}
function brief(value:unknown,size=480){
  return typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,size):''
}
/** Context resets between model calls; the facts live in the .lumen project.
 * Issue one narrow task with explicit progress and source-only constraints. */
export function constructionTaskPrompt(raw:unknown, recovery?:string) {
  const s=(raw&&typeof raw==='object'?raw:{}) as Snapshot
  const stage=stageOf(s)
  const missing=Array.isArray(s.missing_timeline_transcripts)
    ?s.missing_timeline_transcripts.filter((x):x is string=>typeof x==='string').slice(0,5):[]
  const uncovered=Array.isArray(s.status?.uncovered)?s.status.uncovered.map(safeRange).filter((x):x is ShortRange=>!!x):[]
  const fps=Number(s.fps)>0&&Number(s.fps)<=240?Number(s.fps):30
  const first=uncovered[0]
  const reviewIssues=(s.review&&typeof s.review==='object'&&Array.isArray((s.review as {issues?:unknown}).issues))
    ?(s.review as {issues:string[]}).issues.filter(x=>typeof x==='string').slice(0,3):[]
  const bounded=first?{start:first.start,end:Math.min(first.end,first.start+Math.round(fps*60))}:null
  let task:string
  if(missing.length){
    task=`First transcribe ONE permitted audible asset lacking a transcript: ${missing[0]}. Use transcribe_media and verify the saved result before scanning; do not invent a transcript. More pending IDs: ${missing.length-1} on this status page.`
  } else if(stage==='discover'){
    task=bounded?`Scan ONE not-yet-indexed current-timeline range [${bounded.start}, ${bounded.end}) with scan_construction_events. This scan finds search candidates only. Do not label them jokes or safe-to-cut based solely on audio levels.`
      :'Retrieve discovery scan gaps using get_video_construction; do not guess timeline ranges.'
  } else if(stage==='investigate'){
    task=bounded?`Inspect ONE uncovered timeline span [${bounded.start}, ${bounded.end}) using inspect_video_range, record grounded audiovisual findings with update_video_construction, and stop after saving. Use focused inspection for suspicious visual events.`
      :'Fetch the next unfinished inspected range and save one source-grounded finding.'
  } else if(stage==='map'){
    task='Build or revise ONE coherent chapter/scene group from the indexed footage and recorded evidence. Keep rules, round/night starts and endings, complete jokes, delayed callbacks and natural reaction tails. Check earlier context before asserting a story link. Save the story map.'
  } else if(stage==='refine'){
    task=count(s.discoveryPending)>0
      ?'Use get_discovery_queue to find a candidate potentially affected by proposed deletions. Inspect its exact range using focused frames and real audio if necessary; save a justified keep/discard/uncertain decision. Do not discard based on a sampled overview.'
      :'Choose ONE unresolved scene/cut decision. Inspect its setup/payoff context and exact edge frames, revise the plan, and validate only when enough evidence exists. Do not apply unreviewed destructive edits.'
  } else if(stage==='review'){
    task=reviewIssues.length
      ?`A completed review found a real defect: ${reviewIssues.map(x=>brief(x,180)).join(' | ')}. Use begin_construction_repair for one focused, bounded correction pass on the CURRENT permitted timeline; do not claim the edit is finished or assume deleted source is recoverable.`
      :'Inspect ONE unfinished edited join or a short part of the actual output, including mixed audio. Record grounded evidence; finalize review only after every join and required story section has been checked.'
  } else {
    task='Read get_video_construction and report the unresolved blocker; do not repeat destructive actions.'
  }
  return [
    'LUMEN AUTONOMOUS VIDEO CONSTRUCTION — NEXT SMALL VERIFIED STEP',
    `Goal: ${brief(s.goal,2000)||'Use the saved project goal'}`,
    `Saved state: stage=${stage}; revision=${count(s.revision)}; fps=${fps}; discovery scans=${count(s.discoveryScans?.total)}; candidates=${count(s.discoveryEvents?.total)}; pending candidates=${count(s.discoveryPending)}; beats=${count(s.beats?.total)}; proposed cuts=${count(s.cuts?.total)}.`,
    recovery?`Recovery: ${brief(recovery,250)}. The previous request may have partially executed. Re-read saved state; do NOT replay unverified edits.`:'',
    `Task: ${task}`,
    'Start with get_video_construction (limit 5) and follow its current saved status. Do only this focused work unit, persist a durable checkpoint and return a concise result. No need to solve the whole movie in this call.',
    'Only the ORIGINAL authorised timeline footage is permitted; background research is not evidence the recorded events happened. Inspect before claiming. Do not invent missing media or timings. If a step is unsupported or fails, preserve the checkpoint and report the blocker.',
  ].filter(Boolean).join('\n')
}

function status(err:unknown):number|undefined{
  if(!err || typeof err!=='object')return undefined
  const e=err as {status?:unknown;statusCode?:unknown;response?:{status?:unknown};cause?:unknown}
  const raw=e.statusCode??e.status??e.response?.status
  if(typeof raw==='number'&&Number.isFinite(raw))return raw
  return e.cause&&e.cause!==err?status(e.cause):undefined
}
function signalCode(err:unknown):string{
  if(!err || typeof err!=='object')return ''
  const e=err as {code?:unknown;name?:unknown;message?:unknown;cause?:unknown}
  return [e.code,e.name,e.message, e.cause&&e.cause!==err?signalCode(e.cause):'']
    .filter((x):x is string=>typeof x==='string').join(' ').slice(0,700)
}
/** Retry only transport/transient failures, never invalid tools, auth or saved
 * state errors. An explicit deadline is known separately from user cancellation.
 */
export function isTransientConstructionError(err:unknown,deadlineExceeded=false){
  if(deadlineExceeded)return true
  const http=status(err)
  if(http!==undefined)return [408,409,425,429,500,502,503,504].includes(http)
  return /\b(ETIMEDOUT|ECONNRESET|ECONNABORTED|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|AbortError|TimeoutError)\b|timeout|timed out|socket hang up|network connection lost|fetch failed/i.test(signalCode(err))
}
export function constructionRetryDelayMs(attempt:number,err:unknown) {
  if(!Number.isSafeInteger(attempt)||attempt<1)throw new Error('Retry attempt must be positive')
  return Math.min(12_000,(status(err)===429?2500:750)*Math.pow(2,Math.min(5,attempt-1)))
}
/** Wait between retries, but honour user cancellation immediately. */
export function waitForRetry(ms:number,signal:AbortSignal):Promise<void>{
  if(signal.aborted)return Promise.reject(signal.reason??new Error('Cancelled'))
  return new Promise((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel)}
    const cancel=()=>{done();reject(signal.reason??new Error('Cancelled'))}
    const timer=setTimeout(()=>{done();resolve()},ms)
    signal.addEventListener('abort',cancel,{once:true})
  })
}

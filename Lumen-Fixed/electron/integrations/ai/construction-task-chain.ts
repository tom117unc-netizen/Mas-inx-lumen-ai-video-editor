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
  indexing?:{state?:unknown;percent?:unknown;remainingFrames?:unknown;error?:unknown}
  missing_timeline_transcripts?:unknown
  next_context_section?:unknown;next_context_probe?:unknown;next_context_inspection_ids?:unknown;next_edit_section?:unknown
  sectionPlan?:{context_target_frames?:unknown;edit_target_frames?:unknown;pending_context?:unknown;pending_editing?:unknown}
  discoveryPending?:unknown
  sourceSelections?:{total?:unknown}
  beats?:{total?:unknown};cuts?:{total?:unknown}
  discoveryScans?:{total?:unknown};discoveryEvents?:{total?:unknown};eventFindings?:{total?:unknown}
  inspections?:{total?:unknown};joinAudioChecks?:{total?:unknown}
  applied?:unknown;assembly?:{sequence_id?:unknown};review?:unknown
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
  const nextBank=s.next_context_section&&typeof s.next_context_section==='object'
    ?s.next_context_section as {id?:unknown;start?:unknown;end?:unknown}:null
  const nextEdit=s.next_edit_section&&typeof s.next_edit_section==='object'
    ?s.next_edit_section as {id?:unknown;start?:unknown;end?:unknown}:null
  const editLabel=typeof nextEdit?.id==='string'?nextEdit.id:'the next unplanned edit section'
  const bankLabel=typeof nextBank?.id==='string'?nextBank.id:'the next unbanked context section'
  const bankRange=nextBank?safeRange(nextBank as {start:number;end:number}):null
  const bankProbe=s.next_context_probe?safeRange(s.next_context_probe as {start:number;end:number}):null
  const bankEvidence=Array.isArray(s.next_context_inspection_ids)?s.next_context_inspection_ids.filter(x=>typeof x==='string').slice(0,64):[]
  const editRange=nextEdit?safeRange(nextEdit as {start:number;end:number}):null
  const reviewIssues=(s.review&&typeof s.review==='object'&&Array.isArray((s.review as {issues?:unknown}).issues))
    ?(s.review as {issues:string[]}).issues.filter(x=>typeof x==='string').slice(0,3):[]
  const bounded=first?{start:first.start,end:Math.min(first.end,first.start+Math.round(fps*60))}:null
  let task:string
  if(missing.length){
    task=`First transcribe ONE permitted audible asset lacking a transcript: ${missing[0]}. Use transcribe_media and verify the saved result before scanning; do not invent a transcript. More pending IDs: ${missing.length-1} on this status page.`
  } else if(stage==='discover'){
    const indexState=s.indexing?.state
    task=indexState==='running'||indexState==='pausing'
      ?'The local media indexing job is already running; no further model/media scan calls are necessary. Return so the Copilot can wait without spending AI requests. Check get_construction_indexing only if troubleshooting is needed.'
      :indexState==='failed'||indexState==='stale'
      ?`The local indexing worker stopped: ${brief(s.indexing?.error,250)}. Do not claim discovery is complete; preserve the saved checkpoint and report the source-media problem.`
      :`Start the one-call resumable LOCAL whole-timeline worker with start_construction_indexing. ${bounded?`The first remaining authorised range begins [${bounded.start}, ${bounded.end});`:''} it automatically handles every remaining original source interval, saves each completed scan and adjusts chunk sizes to actual event density. Do NOT make a separate AI tool call for each minute. Index signals only locate candidates, not game event meaning or humour.`
  } else if(stage==='context-bank'){
    task=bankRange?`GLOBAL CONTEXT BANKING PASS, before editing: work on section ${bankLabel} [${bankRange.start}, ${bankRange.end}). ${bankProbe?`Inspect only the NEXT uncovered [${bankProbe.start}, ${bankProbe.end}) with inspect_video_range (overview first; focus on important signals).`:`Inspections cover the entire section; call record_construction_context_section with the relevant existing receipts: ${bankEvidence.join(', ')||'fetch saved receipts'}.`} Consult get_source_transcript / get_source_observations for authorised assets. Bank real key moments, rule/night/round progression, distant callback leads and uncertainties. Do not start choosing deletions until the WHOLE recording is banked.`
      :'Use get_construction_checkpoint to identify the next unbanked context section and finish indexing the WHOLE original timeline before editing.'
  } else if(stage==='investigate'){
    task=bounded?`Inspect ONE uncovered timeline span [${bounded.start}, ${bounded.end}) using inspect_video_range, record grounded audiovisual findings with update_video_construction, and stop after saving. Before interpreting a local event, retrieve its section's full bank context and any linked earlier/later setup; use focused inspection for suspicious visual events.`
      :'Fetch the next unfinished inspected range and save one source-grounded finding.'
  } else if(stage==='map'){
    task=`Build or revise ONE coherent chapter/scene group and record directly observed challenge rules, round/night transitions, joke setups/payoffs and callbacks via record_construction_narrative_moments with exact source-frame evidence, starting with ${editLabel}${editRange?` [${editRange.start}, ${editRange.end})`:''}. FIRST call get_construction_edit_context with a question about the goal, chronology and possible callbacks. Its global indexed context is available without loading the full video; query earlier and later setups whenever useful. Keep rules, round/night starts/endings, complete jokes and natural reaction tails. Save the beat map.`
  } else if(stage==='refine'){
    task=count(s.discoveryPending)>0
      ?'Use get_discovery_queue and get_event_investigation_queue to find ONE narrative-relevant unresolved candidate. Inspect actual original source footage in focused frames and listen to real audio if interpretation depends on sound. Save what was directly observed or remains uncertain with record_construction_event_findings, then judge whether the event must be kept. Never discard from sparse overview.'
      :`Plan ONE local section ${editLabel}${editRange?` [${editRange.start}, ${editRange.end})`:''} using get_construction_edit_context, which searches the complete bank. Investigate distant setup/payoff links, inspect edge frames, record relevant beats/cuts, then call record_construction_edit_section with real receipts. Never treat local footage as self-contained if its humour or story requires another section. Do not apply until ALL editing sections are planned.`
  } else if(stage==='assemble'){
    task=count(s.sourceSelections?.total)
      ?'KEEP-FIRST ASSEMBLY: reread sourceSelections, the narrativeMoments ledger, and the full source-backed story plan. Continue recording remaining strongest original-timeline moments with record_keep_first_selections, including the complete opening hook/setup, essential dependencies, unresolved events and meaningful ending, in FINAL narrative order. Use preview_keep_first_assembly to see candidate joins and whether audio preflight is missing; audition ONE unchecked original-source join at a time with inspect_keep_first_join_audio (real WAV to a supported audio model), refine cuts around speech/reactions/music if needed, then publish_keep_first_assembly to create a NEW editable timeline. Recheck the actual mixed audio after publishing, because preview and output may differ. If validation fails, inspect and correct ONLY the flagged omission/order/edge; never delete the original timeline.'
      :'KEEP-FIRST STORY SELECTION: use the essential narrativeMoments ledger, verified setup/payoff links and full context bank and actual inspected original timeline evidence to select the first few strongest story moments via record_keep_first_selections. State explicit output_order, real source start/end, role, beat_id and inspector receipt IDs. Build hook, setup, escalation, payoff and ending across several small calls. Do NOT import new footage or apply destructive timeline.removeRange.';
  } else if(stage==='review'){
    task=reviewIssues.length
      ?`A completed review found a real defect: ${reviewIssues.map(x=>brief(x,180)).join(' | ')}. ${s.assembly?'Use reopen_construction_source_for_repair to restore the intact original timeline, saved evidence and all source selections, then revise ONLY the failed moments and rebuild a new output version.':'For legacy destructive output, use begin_construction_repair on the current timeline without claiming omitted footage can be restored.'} Never mark the video complete until actual output evidence and review checks pass.`
      :'INDEPENDENT OUTPUT CRITIC: call audit_output_narrative first. Work on ONE missing or unverified essential output moment or join from its returned issues, and inspect the ACTUAL edited output with pictures and real mixed audio, not the original source and not a self-attested story summary. Repair the specific missing rule, round outcome, setup/payoff or callback with source-backed restoration when needed. Only call review_video_construction once all required moments and joins have evidence; structural audit failures are mandatory issues.'
  } else {
    task='Read get_construction_checkpoint and report the unresolved blocker; do not repeat destructive actions.'
  }
  return [
    'LUMEN AUTONOMOUS VIDEO CONSTRUCTION — NEXT SMALL VERIFIED STEP',
    `Goal: ${brief(s.goal,2000)||'Use the saved project goal'}`,
    `Saved state: stage=${stage}; revision=${count(s.revision)}; fps=${fps}; context bank pending=${count(s.sectionPlan?.pending_context)}; local edit sections pending=${count(s.sectionPlan?.pending_editing)}; context target frames=${count(s.sectionPlan?.context_target_frames)}; editing target frames=${count(s.sectionPlan?.edit_target_frames)}; discovery scans=${count(s.discoveryScans?.total)}; candidates=${count(s.discoveryEvents?.total)}; interpreted=${count(s.eventFindings?.total)}; pending candidates=${count(s.discoveryPending)}; beats=${count(s.beats?.total)}; proposed cuts=${count(s.cuts?.total)}; retained source selections=${count(s.sourceSelections?.total)}.`,
    recovery?`Recovery: ${brief(recovery,250)}. The previous request may have partially executed. Re-read saved state; do NOT replay unverified edits.`:'',
    `Task: ${task}`,
    'Start with get_construction_checkpoint and follow its small saved status. Request only relevant paginated source evidence using get_video_construction when necessary; do not load the full editorial ledger. Do only this focused work unit, persist a durable checkpoint and return a concise result. No need to solve the whole movie in this call.',
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
  const chain=signalCode(err)
  const interrupted=/\b(ETIMEDOUT|ECONNRESET|ECONNABORTED|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|AbortError|TimeoutError)\b|timeout|timed out|socket hang up|network connection lost|fetch failed|\bterminated\b/i.test(chain)
  // HTTP headers may have arrived with 200 OK before the response body was
  // truncated. The SDK then wraps the actual network cause in a non-retryable
  // "Failed to process successful response" error. Only retry that exact
  // case when an independently recognisable transport cause is present.
  // Bad JSON, schema mismatches and missing tool-calling support are NOT
  // transient and must not trigger duplicate editing requests.
  if(http===200)return /Failed to process successful response/i.test(chain)&&interrupted
  if(http!==undefined)return [408,409,425,429,500,502,503,504].includes(http)
  return interrupted
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

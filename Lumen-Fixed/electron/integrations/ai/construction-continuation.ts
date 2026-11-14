/** Only explicit workflow execution authorizes autonomous follow-on batches.
 * A status query, isolated inspection or plan annotation is not that authority. */
export function isConstructionExecutionTool(name: string) {
  return name === 'begin_video_construction' || name === 'resume_video_construction' || name === 'begin_construction_repair'
}

/** A bounded continuation policy; the durable project, not chat history, is the
 * authority for unfinished work. Repeated no-progress snapshots stop the loop. */
export function constructionContinuation(snapshot:unknown,batches:number,previousProgress?:string) {
  const value=snapshot as {status?:{stage?:string;complete?:boolean};inspections?:{total?:number};coverage?:{total?:number};beats?:{total?:number};cuts?:{total?:number};contextInspections?:{total?:number};discoveryScans?:{total?:number};discoveryEvents?:{total?:number};discoveryPending?:number;audioSamples?:{total?:number};audioObservations?:{total?:number};joinAudioChecks?:{total?:number};repairOf?:{depth?:number};review?:unknown} | null
  const stage=value?.status?.stage
  const progress=JSON.stringify([stage,value?.inspections?.total,value?.coverage?.total,value?.beats?.total,value?.cuts?.total,value?.contextInspections?.total,value?.discoveryScans?.total,value?.discoveryEvents?.total,value?.discoveryPending,value?.audioSamples?.total,value?.audioObservations?.total,value?.joinAudioChecks?.total,value?.repairOf?.depth,value?.review])
  if(!stage || value?.status?.complete || stage==='stale') return {continue:false,progress,reason:stage==='stale'?'Timeline changed; refresh the plan.':'No unfinished construction.'}
  if(stage==='paused') return {continue:false,progress,reason:'Construction paused. Its story map and progress are saved.'}
  if(!['discover','investigate','map','refine','review'].includes(stage)) return {continue:false,progress,reason:'Unknown construction state.'}
  if(batches>=12) return {continue:false,progress,reason:'Automatic work budget reached. Construction is saved but unfinished; resume from get_video_construction.'}
  if(progress===previousProgress) return {continue:false,progress,reason:'No construction progress in the last batch. Work is unfinished; explain the blocker rather than repeat tools.'}
  return {continue:true,progress,reason:'Continue the saved construction workflow. Call get_video_construction, first scan each permitted original timeline interval with scan_construction_events and investigate/resolve event candidates before deleting them, then inspect remaining audiovisual gaps, retrieve scene-specific context for remaining cuts, inspect actual mixed audio at joins, and where it changes editorial decisions listen to bounded audio on a supported Gemini model, or refine/review the next scene; if a review has unresolved problems use begin_construction_repair, up to the bounded retry limit. Do not repeat completed analysis. Do not claim completion until its status is complete.'}
}

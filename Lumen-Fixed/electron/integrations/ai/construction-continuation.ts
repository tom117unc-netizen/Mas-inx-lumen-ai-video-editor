/** Only explicit workflow execution authorizes autonomous follow-on batches.
 * A status query, isolated inspection or plan annotation is not that authority. */
import { CONSTRUCTION_MAX_BATCHES } from './construction-task-chain'

export function isConstructionExecutionTool(name: string) {
  return name === 'begin_video_construction' || name === 'resume_video_construction' || name === 'begin_construction_repair' || name === 'reopen_construction_source_for_repair'
}

/** A bounded continuation policy; the durable project, not chat history, is the
 * authority for unfinished work. Repeated no-progress snapshots stop the loop. */
export function constructionContinuation(snapshot:unknown,batches:number,previousProgress?:string) {
  const value=snapshot as {sectionPlan?:{pending_context?:number;pending_editing?:number};revision?:number;status?:{stage?:string;complete?:boolean};inspections?:{total?:number};coverage?:{total?:number};beats?:{total?:number};cuts?:{total?:number};contextInspections?:{total?:number};sourceSelections?:{total?:number};assembly?:{sequence_id?:string};discoveryScans?:{total?:number};discoveryEvents?:{total?:number};discoveryPending?:number;audioSamples?:{total?:number};audioObservations?:{total?:number};joinAudioChecks?:{total?:number};repairOf?:{depth?:number};review?:unknown} | null
  const stage=value?.status?.stage
  const progress=JSON.stringify([stage,value?.revision,value?.sectionPlan?.pending_context,value?.sectionPlan?.pending_editing,value?.inspections?.total,value?.coverage?.total,value?.beats?.total,value?.cuts?.total,value?.sourceSelections?.total,value?.assembly?.sequence_id,value?.contextInspections?.total,value?.discoveryScans?.total,value?.discoveryEvents?.total,value?.discoveryPending,value?.audioSamples?.total,value?.audioObservations?.total,value?.joinAudioChecks?.total,value?.repairOf?.depth,value?.review])
  if(!stage || value?.status?.complete || stage==='stale') return {continue:false,progress,reason:stage==='stale'?'Timeline changed; refresh the plan.':'No unfinished construction.'}
  if(stage==='paused') return {continue:false,progress,reason:'Construction paused. Its story map and progress are saved.'}
  if(!['discover','context-bank','investigate','map','refine','assemble','review'].includes(stage)) return {continue:false,progress,reason:'Unknown construction state.'}
  if(batches>=CONSTRUCTION_MAX_BATCHES) return {continue:false,progress,reason:'Bounded automatic chain budget reached. The verified project checkpoint is saved; use resume_video_construction to continue without starting over.'}
  if(progress===previousProgress) return {continue:false,progress,reason:'No construction progress in the last batch. Work is unfinished; explain the blocker rather than repeat tools.'}
  return {continue:true,progress,reason:'Advance one small, source-grounded editing task from the saved construction checkpoint, then verify and save its result. Never assume a previous model request finished if the project does not confirm it.'}
}

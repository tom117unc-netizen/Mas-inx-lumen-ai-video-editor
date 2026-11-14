/** A stateful editorial workflow over the existing frame-based editor. */
import { z } from 'zod'
import { beginConstruction, constructionFingerprint, constructionStatus, constructionStorySignature, mergeRanges, nextEventProbe, updateConstruction, validateConstructionCuts, type ConstructionState } from '@/editor/video-construction'
import { dispatch, getProject, recordVideoConstruction, rollbackTo, savepoint, useEditor } from '@/editor/store'
import { timelineTranscript } from '@/editor/smart'
import { assertSpeechSafeCuts, relatedStoryContext, speechCutContext } from '@/editor/construction-context'
import { assessVideoQuality, defaultVideoBrief } from '@/editor/video-quality'
import { timelineStills, canvasBase64 } from '@/engine/stills'
import { saveProject, useSession } from '@/project/session'
import { INSPECT_TOOLS } from './inspect'
import { bool, int, list, obj, oneOf, str, withImages, type AgentTool } from './kit'
import { uid } from '@/lib/id'

function state(fresh=true):ConstructionState {
  const p=getProject(),s=p.construction
  if(!s) throw new Error('Call begin_video_construction first')
  if(fresh && constructionStatus(p,s).stage==='stale') throw new Error('Timeline changed: construction is stale; begin a new pass after reviewing the current state')
  return s
}
async function persist(s:ConstructionState) {
  recordVideoConstruction(s.projectId,s)
  // Explicit save, not merely an in-memory checkpoint. Browser-only use is
  // rejected at begin; a failed save is visible and must not be called durable.
  if(!await saveProject()) throw new Error('Construction updated in memory, but saving failed. Save the project before continuing.')
}
const frame=int('Exact integer timeline frame, not seconds',{minimum:0})
const rangeFields={start_frame:frame,end_frame:frame}
const evidence=list('Inspection receipt IDs returned by inspect_video_range',str('Receipt ID'),{minItems:1,maxItems:64})
const span={start:frame,end:frame}
const beat=obj({id:str('Stable ID'),...span,kind:oneOf('Story level',['chapter','scene','setup','payoff','reaction','callback','continuity']),summary:str('What happens and why it matters'),parentId:str('Optional containing chapter/scene ID'),dependsOn:list('Earlier essential beats this beat requires',str('Beat ID')),protectedRanges:list('Essential visual or audio moments that cuts must preserve',obj({...span,reason:str('Why this interval must survive')},['start','end','reason']))},['id','start','end','kind','summary'])
const coverage=obj({id:str('Stable ID'),...span,visual:str('Actual visual findings, including uneventful spans'),audio:str('Speech/sound context, uncertainty and limitations'),evidenceIds:evidence},['id','start','end','visual','audio','evidenceIds'])
const cut=obj({id:str('Stable ID'),...span,beatId:str('Containing scene/chapter ID'),reason:str('Editorial reason'),visualReason:str('Why no essential action, anticipation or reaction is lost'),audioReason:str('Why speech/delivery/sound continuity survives; disclose uncertain listening'),evidenceIds:evidence},['id','start','end','beatId','reason','visualReason','audioReason','evidenceIds'])

export const VIDEO_CONSTRUCTION_TOOLS:AgentTool[]=[
  {
    name:'resume_video_construction',
    description:'Explicitly resume autonomous work on the saved construction plan. Use only when the user requests continuing the video edit, never for a status-only query. Stale timelines require a new pass.',
    inputSchema:obj({}),
    run:async()=>{ const s=structuredClone(state());s.paused=false;await persist(s);return {status:constructionStatus(getProject(),s),resumed:true} },
  },
  {
    name:'pause_video_construction',
    description:'Pause construction and release its AI editing safeguards while preserving the story map and progress. Ordinary edits are then allowed; changes to the timeline will make the old plan stale.',
    inputSchema:obj({}),
    run:async()=>{ const s=structuredClone(state(false));s.paused=true;await persist(s);return {paused:true,saved:true} },
  },

  {
    name:'begin_video_construction',
    description:'Begin a persistent whole-video construction pass over ONLY the current timeline. Snapshots permitted ranges and current project identity, then requires audiovisual investigation, a layered story map and frame-level cut review. Save the project first. Resume existing work with get_video_construction.',
    inputSchema:obj({goal:str('Premise, audience, desired duration and editing intent'),restart:bool('Explicitly discard an existing plan and start a new pass')},['goal']),
    run:async a=>{
      if(!useSession.getState().path) throw new Error('Save the project before beginning persistent construction')
      if(getProject().construction && a.restart!==true) throw new Error('Construction already exists: resume with get_video_construction or explicitly restart')
      const s=beginConstruction(getProject(),String(a.goal??''));await persist(s)
      return {status:constructionStatus(getProject(),s),scope:s.scope,fps:s.fps}
    },
  },
  {
    name:'get_video_construction',
    description:'Resume the saved editorial workflow: reports investigation gaps, layered story beats, proposed cuts, post-edit joins and completion state. Paginate records instead of relying on chat history. A stale plan must be re-mapped before applying.',
    inputSchema:obj({offset:int('Record offset, default 0',{minimum:0}),limit:int('Records per collection, default 40, max 100',{minimum:1,maximum:100})}),
    run:async a=>{
      const s=state(false),offset=z.number().int().min(0).parse(a.offset??0),limit=z.number().int().min(1).max(100).parse(a.limit??40)
      const page=<T>(items:T[])=>({total:items.length,items:items.slice(offset,offset+limit),next_offset:offset+limit<items.length?offset+limit:null})
      const status=constructionStatus(getProject(),s)
      return {goal:s.goal,fps:s.fps,status:{...status,uncovered:status.uncovered.slice(0,100),uncovered_count:status.uncovered.length},scope:page(s.scope),beats:page(s.beats),coverage:page(s.coverage),cuts:page(s.cuts),inspections:page(s.inspections),contextInspections:page(s.contextInspections??[]),applied:s.applied,review:s.review}
    },
  },
  {
    name:'update_video_construction',
    description:'Upsert bounded coverage, story beats and proposed removals into persistent construction memory. Only inspected timeline ranges count as coverage. Record essential setup/payoff dependencies and protected silent visual moments. This tool plans; it never changes footage.',
    inputSchema:obj({beats:list('Upsert story beats by ID; include referenced parents/dependencies',beat,{maxItems:100}),coverage:list('Upsert inspected coverage by ID',coverage,{maxItems:100}),cuts:list('Upsert exact proposed removals by ID',cut,{maxItems:100}),remove_cut_ids:list('Remove obsolete proposals',str('Cut ID'),{maxItems:100})}),
    run:async a=>{
      const s=state(),changes:Record<string,unknown>={}
      for(const key of ['beats','coverage','cuts'] as const) {
        if(a[key]!==undefined) {
          const items=z.array(z.object({id:z.string()} ).passthrough()).max(100).parse(a[key])
          const merged=new Map<string,unknown>(s[key].map(x=>[x.id,x]))
          for(const item of items) merged.set(item.id,item)
          changes[key]=[...merged.values()]
        }
      }
      if(a.remove_cut_ids!==undefined) {
        const ids=z.array(z.string()).max(100).parse(a.remove_cut_ids)
        changes.cuts=((changes.cuts??s.cuts) as {id:string}[]).filter(c=>!ids.includes(c.id))
      }
      const next=updateConstruction(s,changes);await persist(next);return {status:constructionStatus(getProject(),next),saved:true}
    },
  },
  {
    name:'inspect_video_range',
    description:'Inspect synchronized timeline pictures, transcript and audio metrics, and save a receipt. Overview samples up to 12 frames over at most 60 seconds; boundary mode returns EVERY frame in a maximum 12-frame range as separate 1280px images. Overview coverage is coarse, not proof of every event. Use boundary mode at both proposed cut edges and new joins. Numeric audio metrics are NOT listening.',
    inputSchema:obj({...rangeFields,mode:oneOf('Inspection detail',['overview','boundary']),width:int('Separate image width; default 1280, max 1920',{minimum:256,maximum:1920})},['start_frame','end_frame','mode']),
    run:async a=>{
      const s=state(),p=getProject(),fingerprint=constructionFingerprint(p)
      const start=z.number().int().nonnegative().parse(a.start_frame),end=z.number().int().min(start+1).parse(a.end_frame)
      const mode=z.enum(['overview','boundary']).parse(a.mode),width=z.number().int().min(256).max(1920).parse(a.width??1280)
      const permitted=s.applied?mergeRanges(Object.values(p.clips).map(c=>({start:c.start,end:c.start+c.duration}))):s.scope
      if(!permitted.some(r=>start>=r.start && end<=r.end)) throw new Error('Inspection outside permitted timeline ranges')
      if(end-start>(mode==='boundary'?12:60*p.settings.fps)) throw new Error('Inspection too large: boundary maximum 12 frames; overview maximum 60 seconds')
      if(s.inspections.length>=6000) throw new Error('Inspection budget reached; start a focused new pass')
      const count=Math.min(12,end-start)
      const frames=Array.from({length:count},(_,i)=>mode==='boundary'?start+i:Math.round(start+i*(end-start-1)/Math.max(1,count-1)))
      const images=await timelineStills(p,frames,width)
      const transcript=timelineTranscript(p,start/p.settings.fps,end/p.settings.fps).slice(0,200)
      const audio=await INSPECT_TOOLS.find(t=>t.name==='analyze_audio')!.run({from_seconds:start/p.settings.fps,to_seconds:end/p.settings.fps})
      if(constructionFingerprint(getProject())!==fingerprint || getProject().construction!==s) throw new Error('Project or construction changed during inspection; retry')
      const receipt={id:uid('inspection'),start,end,frames,audio:true,transcript:transcript.length>0}
      const next=structuredClone(s);next.inspections.push(receipt);await persist(next)
      return withImages({inspection_id:receipt.id,frames,fps:p.settings.fps,start_frame:start,end_frame:end,mode,transcript,audio,audio_note:'Audio metrics are not listening: inspect transcript and visual action; mark delivery/game-sound interpretation uncertain unless directly supported.',coverage_note:mode==='overview'?'Sampled overview only. Investigate between samples for brief, silent or ambiguous events.':'Every frame in this short range is included.'},images.map(c=>({data:canvasBase64(c),mimeType:'image/jpeg' as const})))
    },
  },
  {
    name:'inspect_cut_context',
    description:'Before accepting an exact removal, retrieve its containing scene, earlier setups, later dependent callbacks, nearby story beats, and the actual timeline transcript on both sides. Saves a context-read receipt tied to the current story map and cut coordinates; never proves that unseen/silent events are unimportant. If speech intersects a boundary, refine the cut and inspect again.',
    inputSchema:obj({cut_id:str('ID of an already proposed cut'),context_seconds:int('Seconds of transcript before/after the cut, default 12, max 60',{minimum:1,maximum:60})},['cut_id']),
    run:async a=>{
      const s=state(),p=getProject(),fingerprint=constructionFingerprint(p)
      if(s.applied) throw new Error('The plan is already applied; review edited joins instead')
      const cutId=z.string().trim().min(1).max(128).parse(a.cut_id)
      const contextSeconds=z.number().int().min(1).max(60).parse(a.context_seconds??12)
      const story=relatedStoryContext(s,cutId)
      const speech=speechCutContext(p,story.cut,contextSeconds)
      const storySignature=constructionStorySignature(s)
      if(constructionFingerprint(getProject())!==fingerprint || getProject().construction!==s) throw new Error('Project or story map changed during context retrieval; retry')
      if(speech.violations.length) return {story,speech,recorded:false,safe_to_apply:false,next:'Speech crosses a proposed boundary. Refine the frames, inspect actual audio and retrieve context again.'}
      const next=structuredClone(s)
      next.contextInspections=[...(next.contextInspections??[]).filter(r=>r.cutId!==cutId),{cutId,storySignature}]
      await persist(next)
      return {story,speech,recorded:true,safe_to_apply:'No transcribed phrase crosses an edge; untranscribed speech or sounds are still unverified',
        recommended_inspection_ranges:[story.focus,...story.dependencies,...story.related].map(b=>({beat_id:b.id,start_frame:b.start,end_frame:b.end})).slice(0,80),
        note:'This receipt certifies context was retrieved, not that a model understood every setup, joke or reaction. Inspect relevant audio and video, refine protected moments and make a deliberate editorial judgement.'}
    },
  },
  {
    name:'next_event_probe',
    description:'Plan a frame-exact bisection probe for a single bracketed visual state change. First inspect both endpoints. Use only when the interval has one change; for repeats or unknown behaviour scan shorter windows instead. It plans the next frame and does not observe the event itself.',
    inputSchema:obj({left_frame:frame,right_frame:frame,left_present:bool('Observed state at left'),right_present:bool('Observed state at right'),single_change:bool('The inspected interval supports one change, not repeated appearances')},['left_frame','right_frame','left_present','right_present','single_change']),
    run:async a=>nextEventProbe(z.number().parse(a.left_frame),z.number().parse(a.right_frame),z.boolean().parse(a.left_present),z.boolean().parse(a.right_present),z.boolean().parse(a.single_change)),
  },
  {
    name:'apply_video_construction',
    description:'Validate and apply the planned removals to the current timeline in ONE atomic undo step. Requires complete coarse audiovisual coverage, valid story dependencies, protected moments and neighbouring frames at every edge. Refuses stale state. Review the new joins and whole video afterwards; application is not completion.',
    inputSchema:obj({preview:bool('Validate without applying; default false')}),
    run:async a=>{
      const s=state(),p=getProject(),cuts=validateConstructionCuts(p,s)
      assertSpeechSafeCuts(p,cuts)
      if(a.preview===true) return {valid:true,cuts,applied:false}
      const joins:number[]=[];let removed=0
      for(const c of [...cuts].reverse()) {joins.push(c.start-removed);removed+=c.end-c.start}
      useEditor.getState().transaction('Construct video from reviewed story plan','ai',()=>{
        const mark=savepoint()
        if(!mark) throw new Error('Cannot start atomic construction')
        try {
          for(const c of cuts) {const result=dispatch('timeline.removeRange',{start:c.start,end:c.end},{source:'ai'});if(!result.ok) throw new Error(result.error)}
        } catch(error) {rollbackTo(mark);throw error}
      })
      const next=structuredClone(s);next.applied={fingerprint:constructionFingerprint(getProject()),joins};next.inspections=[];next.review=undefined
      await persist(next)
      return {applied:true,joins,removed_frames:removed,status:'review-required',undoable:true}
    },
  },
  {
    name:'review_video_construction',
    description:'Record a post-edit review after inspecting the actual new joins and whole output. Completion requires every join inspected, sampled audiovisual coverage of the output, explicit story/pacing findings, no unresolved issues and no structural errors. Findings are model judgements, not proof of human-quality editing.',
    inputSchema:obj({story:str('Can a new viewer understand the progression, setups and payoffs?'),pacing:str('Assess internal scene rhythm, necessary silence and transitions'),issues:list('Unresolved problems; empty only if checks passed',str('Problem'),{maxItems:100})},['story','pacing','issues']),
    run:async a=>{
      const s=state();if(!s.applied) throw new Error('Apply the plan before reviewing its output')
      const findings=z.object({story:z.string().trim().min(1).max(4000),pacing:z.string().trim().min(1).max(4000),issues:z.array(z.string().min(1).max(1000)).max(100)}).parse(a)
      const p=getProject(),ranges=mergeRanges(Object.values(p.clips).map(c=>({start:c.start,end:c.start+c.duration})))
      const inspected=mergeRanges(s.inspections.filter(i=>i.audio&&i.frames.length).map(i=>({start:i.start,end:i.end})))
      if(ranges.some(r=>!inspected.some(i=>i.start<=r.start&&i.end>=r.end))) throw new Error('Inspect the whole output in bounded audiovisual windows before final review')
      const frames=new Set(s.inspections.flatMap(i=>i.frames))
      for(const join of s.applied.joins) for(const f of [join-1,join,join+1]) if(ranges.some(r=>f>=r.start&&f<r.end)&&!frames.has(f)) throw new Error(`Inspect neighbouring frames at edited join ${join}`)
      const quality=assessVideoQuality(p,defaultVideoBrief('gaming-highlights'))
      const issues=[...findings.issues,...quality.findings.filter(f=>f.severity==='error').map(f=>f.message)]
      const next=structuredClone(s);next.review={...findings,issues,joins:s.applied.joins,fingerprint:constructionFingerprint(p)};await persist(next)
      return {status:constructionStatus(p,next),quality}
    },
  },
]

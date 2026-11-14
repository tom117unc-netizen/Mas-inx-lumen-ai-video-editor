/** A stateful editorial workflow over the existing frame-based editor. */
import { z } from 'zod'
import { assertDiscoveryDecisionEvidence, beginConstruction, constructionFingerprint, constructionStatus, constructionStorySignature, mergeRanges, unscannedDiscoveryRanges, nextEventProbe, updateConstruction, validateConstructionCuts, type ConstructionState } from '@/editor/video-construction'
import { audioIndexBins, discoverTimelineEvents } from '@/editor/construction-event-index'
import { nextContextInspectionProbe, planConstructionSections, selectBankContext } from '@/editor/construction-sections'
import { auditPublishedAssembly, composeKeepFirstSequence, validateKeepFirstSelections, validateOutputSourceMap } from '@/editor/construction-assembler'
import { validateNarrativeMoment } from '@/editor/construction-narrative'
import { constructionIndexProgress, pauseConstructionIndexJob, startConstructionIndexJob } from './construction-index-worker'
import { dispatch, getProject, recordVideoConstruction, rollbackTo, savepoint, useEditor } from '@/editor/store'
import { timelineTranscript, untranscribed } from '@/editor/smart'
import { assertSpeechSafeCuts, relatedStoryContext, speechCutContext, transcriptCallbackCandidates } from '@/editor/construction-context'
import { assessVideoQuality, defaultVideoBrief } from '@/editor/video-quality'
import { assessJoinAudio } from '@/editor/construction-join-audio'
import { isAudible, levelFrames, prepareAudio, renderMix } from '@/engine/audio-engine'
import { speechScript } from '@/engine/audio'
import { encodeWav } from '@/engine/wav'
import { timelineStills, canvasBase64 } from '@/engine/stills'
import { contentDelta, toHsv } from '@/engine/scenes'
import { saveProject, useSession } from '@/project/session'
import { INSPECT_TOOLS } from './inspect'
import { bool, int, list, obj, oneOf, str, withAudio, withImages, type AgentTool } from './kit'
import { uid } from '@/lib/id'

/** Sound from a video on an overlay track may also carry commentary; do not
 * mistake a lack of a 'Voice' or 'Main' role for proof of no speech. */
function missingTimelineTranscripts(p:ReturnType<typeof getProject>) {
  // A completed speech-to-text pass can legitimately produce zero phrases for
  // gameplay-only audio. An explicit [] is analysed-but-no-speech-detected,
  // NOT missing metadata. This still is not proof that audio is silent.
  const ids=new Set(untranscribed(p).filter(id=>!Array.isArray(p.assets[id]?.transcript)))
  for(const c of Object.values(p.clips)) {
    if(c.kind!=='video'||!c.assetId||!isAudible(p,c))continue
    const asset=p.assets[c.assetId]
    if(asset && !Array.isArray(asset.transcript) && !speechScript(asset).length)ids.add(asset.id)
  }
  return [...ids]
}
function state(fresh=true):ConstructionState {
  const p=getProject(),s=p.construction
  if(!s) throw new Error('Call begin_video_construction first')
  if(fresh && constructionStatus(p,s).stage==='stale') throw new Error('Timeline changed: construction is stale; begin a new pass after reviewing the current state')
  return s
}
async function persist(s:ConstructionState) {
  // A revised story or candidate decision can preserve the SAME item counts.
  // Revision is durable workflow progress, not chat history bookkeeping.
  s.revision=(getProject().construction?.revision??0)+1
  recordVideoConstruction(s.projectId,s)
  // Explicit save, not merely an in-memory checkpoint. Browser-only use is
  // rejected at begin; a failed save is visible and must not be called durable.
  if(!await saveProject()) throw new Error('Construction updated in memory, but saving failed. Save the project before continuing.')
}
const frame=int('Exact integer timeline frame, not seconds',{minimum:0})
const rangeFields={start_frame:frame,end_frame:frame}
function base64Bytes(bytes:Uint8Array) {
  let binary=''
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192))
  return btoa(binary)
}
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
    run:async()=>{ pauseConstructionIndexJob();const s=structuredClone(state(false));s.paused=true;await persist(s);return {paused:true,saved:true} },
  },

  {
    name:'begin_video_construction',
    description:'Begin a persistent whole-video construction pass over ONLY the current timeline. Snapshots permitted ranges and current project identity, then requires audiovisual investigation, a layered story map and frame-level cut review. Save the project first. Resume existing work with get_video_construction.',
    inputSchema:obj({goal:str('Premise, audience, desired duration and editing intent'),restart:bool('Explicitly discard an existing plan and start a new pass')},['goal']),
    run:async a=>{
      if(!useSession.getState().path) throw new Error('Save the project before beginning persistent construction')
      if(getProject().construction && a.restart!==true) throw new Error('Construction already exists: resume with get_video_construction or explicitly restart')
      const s=beginConstruction(getProject(),String(a.goal??''),true);await persist(s)
      return {status:constructionStatus(getProject(),s),scope:s.scope,fps:s.fps,sections:{context:s.sections?.context.length,editing:s.sections?.editing.length,total_seconds:s.sections?s.sections.originalFrames/s.fps:0}}
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
      const pending=s.sections?.context.find(x=>!x.indexed)
      const sectionReceipts=pending?s.inspections.filter(i=>i.audio&&i.frames.length&&i.start<pending.end&&i.end>pending.start):[]
      const nextContextProbe=pending?nextContextInspectionProbe(pending,sectionReceipts,Math.round(s.fps*60)):null
      return {goal:s.goal,fps:s.fps,revision:s.revision??0,indexing:constructionIndexProgress(s),source_manifest:s.sourceManifest?{sequence_id:s.sourceManifest.sequenceId,fingerprint:s.sourceManifest.fingerprint,source_clips:Object.keys(s.sourceManifest.clips).length}:null,sourceSelections:page(s.sourceSelections??[]),narrativeMoments:page(s.narrativeMoments??[]),assembly:s.assembly?{sequence_id:s.assembly.sequenceId,source_sequence_id:s.assembly.sourceSequenceId,output_frames:s.assembly.outputFrames,selected_spans:page(s.assembly.selections),mapped_moments:page(s.assembly.moments??[]),source_clips:page(s.assembly.clips)}:null,
        next_context_section:pending??null,
        next_context_probe:nextContextProbe?{section_id:pending!.id,...nextContextProbe}:null,
        next_context_inspection_ids:sectionReceipts.map(i=>i.id).slice(0,64),
        next_edit_section:s.sections?.editing.find(x=>!x.planned)??null,
        sectionPlan:s.sections?{context_target_frames:s.sections.contextTargetFrames,edit_target_frames:s.sections.editTargetFrames,context:page(s.sections.context),editing:page(s.sections.editing),pending_context:s.sections.context.filter(x=>!x.indexed).length,pending_editing:s.sections.editing.filter(x=>!x.planned).length}:undefined,missing_timeline_transcripts:missingTimelineTranscripts(getProject()),discovery_required:s.discoveryRequired===true,status:{...status,uncovered:status.uncovered.slice(0,100),uncovered_count:status.uncovered.length},scope:page(s.scope),beats:page(s.beats),coverage:page(s.coverage),cuts:page(s.cuts),inspections:page(s.inspections),contextInspections:page(s.contextInspections??[]),discoveryScans:page(s.discoveryScans??[]),discoveryEvents:page(s.discoveryEvents??[]),discoveryPending:(s.discoveryEvents??[]).filter(e=>!e.decision||e.decision==='uncertain').length,audioSamples:page(s.audioSamples??[]),audioObservations:page(s.audioObservations??[]),joinAudioChecks:page(s.joinAudioChecks??[]),repairOf:s.repairOf,applied:s.applied,review:s.review}
    },
  },
  {
    name:'record_construction_context_section',
    description:'CONTEXT BANKING PASS: after actually examining the entire section (not just the audio level/index) save its compact, verified full-story context. Cite covering real timeline inspection receipt IDs, list factual key moments and uncertainties; a scan candidate alone is not proof of meaning. Index ALL sections before editing. This stores a timeline-scoped synopsis in the saved .lumen project; original source observations remain in the Context Bank.',
    inputSchema:obj({section_id:str('Exact context section ID from sectionPlan'),summary:str('What really happened, setup/payoff, character/round/night progress, with uncertainties',{minLength:25,maxLength:1800}),
      key_moments:list('Timestamp-aware facts or notable setups/reactions discovered in this section',str('Evidence-grounded moment',{minLength:5,maxLength:300}),{maxItems:25}),
      uncertainties:list('Ambiguous, unverified events or missing audio/visual details',str('Uncertain detail',{maxLength:300}),{maxItems:15}),
      inspection_ids:list('Actual inspect_video_range receipts collectively covering this entire section',str('Receipt ID'),{minItems:1,maxItems:64})},
      ['section_id','summary','key_moments','uncertainties','inspection_ids']),
    run:async a=>{
      const s=state()
      if(s.applied||s.paused)throw new Error('Cannot bank changed or paused footage')
      if(unscannedDiscoveryRanges(s).length)throw new Error('Finish candidate discovery across the whole original timeline before banking context sections')
      if(!s.sections)throw new Error('Legacy construction has no adaptive section plan')
      const id=z.string().trim().min(1).parse(a.section_id)
      const section=s.sections.context.find(x=>x.id===id)
      if(!section)throw new Error('Unknown context section ID')
      const summary=z.string().trim().min(25).max(1800).parse(a.summary)
      const moments=z.array(z.string().trim().min(5).max(300)).max(25).parse(a.key_moments)
      const uncertainties=z.array(z.string().trim().min(1).max(300)).max(15).parse(a.uncertainties)
      const ids=z.array(z.string().min(1)).min(1).max(64).parse(a.inspection_ids)
      const receipts=s.inspections.filter(i=>ids.includes(i.id)&&i.audio&&i.frames.length)
      if(!mergeRanges(receipts).some(r=>r.start<=section.start&&r.end>=section.end))
        throw new Error('Context section needs continuous inspection receipt coverage; sparse overviews are sampled evidence, not full-frame observation')
      const next=structuredClone(s)
      const target=next.sections!.context.find(x=>x.id===id)!
      target.indexed=true;target.summary=summary;target.keyMoments=moments;target.uncertainties=uncertainties;target.evidenceIds=ids
      // Reuse the already verified inspector receipts as broad source-coverage
      // metadata. Do NOT pretend those overviews watched every intervening frame
      // or heard meaning: the wording explicitly retains uncertainty.
      next.coverage=[...next.coverage.filter(c=>c.id!==`bank-coverage-${id}`),{
        id:`bank-coverage-${id}`,start:section.start,end:section.end,
        visual:`Sampled audiovisual overview and grounded section summary: ${summary.slice(0,1000)}`,
        audio:`Timed transcript and measured audio (not necessarily heard semantically); uncertainties: ${uncertainties.join('; ').slice(0,900)||'No semantic listening asserted'}`,
        evidenceIds:ids,
      }]
      // A materially updated full-story synopsis invalidates earlier local
      // context reads and editing decisions that were based on it.
      if(section.summary!==summary || !section.indexed){
        next.sections!.reads=[]
        next.contextInspections=[] // New global story knowledge invalidates earlier cut-context readings.
        for(const e of next.sections!.editing){e.planned=false;e.summary=undefined;e.evidenceIds=undefined}
      }
      await persist(next)
      return {saved:true,section_id:id,pending_context:next.sections!.context.filter(x=>!x.indexed).length,
        status:constructionStatus(getProject(),next),note:'Grounded timeline context saved. It can be retrieved selectively from any edit section without loading the full recording.'}
    },
  },
  {
    name:'get_construction_edit_context',
    description:'EDITING PASS: get a compact context pack for ONE local editing section, selected from the FULL timeline-wide section bank. Searches ALL bank summaries, always includes local/linked sections, and returns relevant earlier setups/later callbacks. Specify a concrete question, with known linked_context_ids. This records a context lookup receipt; for raw source evidence also use get_source_transcript and get_source_observations on the returned relevant authorised assets.',
    inputSchema:obj({section_id:str('Exact edit section ID from sectionPlan'),
      question:str('Specific editing question: rule, joke, setup/payoff, chronology or callback',{minLength:3,maxLength:400}),
      linked_context_ids:list('Known setup/return/context sections anywhere in the original timeline',str('Section ID'),{maxItems:16}),
      max_context_items:int('Maximum matching saved global context summaries, default 8, maximum 24',{minimum:1,maximum:24})},
      ['section_id','question']),
    run:async a=>{
      const s=state(),p=getProject()
      if(!s.sections)throw new Error('Legacy plan has no timeline-wide section context index')
      if(s.applied||s.paused)throw new Error('Global edit context is only valid for the original unedited active construction')
      if(s.sections.context.some(c=>!c.indexed))throw new Error('Complete the whole-timeline context banking pass first')
      const id=z.string().trim().min(1).parse(a.section_id)
      const edit=s.sections.editing.find(x=>x.id===id)
      if(!edit)throw new Error('Unknown edit section ID')
      const question=z.string().trim().min(3).max(400).parse(a.question)
      const linked=z.array(z.string()).max(16).parse(a.linked_context_ids??[])
      if(linked.some(x=>!s.sections!.context.some(c=>c.id===x)))throw new Error('Unknown linked global context section')
      const ids=[...new Set([...(edit.contextIds??[]),...linked])]
      const budget=Math.max(z.number().int().min(1).max(24).parse(a.max_context_items??8),ids.length)
      const ranked=selectBankContext(s.sections.context,edit,question,ids,budget)
      const idsFound=ranked.map(x=>x.section.id)
      const previous=s.sections.reads?.find(r=>r.editSectionId===id)
      const alreadySaved=previous?.question===question &&
        JSON.stringify(previous.bankSectionIds)===JSON.stringify(idsFound)
      if(!alreadySaved) {
        const next=structuredClone(s)
        next.sections!.reads=[...(next.sections!.reads??[]).filter(r=>r.editSectionId!==id),
          {editSectionId:id,bankSectionIds:idsFound,revision:s.revision??0,question}]
        await persist(next)
      }
      const clips=Object.values(p.clips).filter(c=>c.assetId&&c.start<edit.end&&c.start+c.duration>edit.start)
      const events=(s.discoveryEvents??[]).filter(e=>e.start<edit.end&&e.end>edit.start)
      return {edit_section:edit,question,global_bank_sections:s.sections.context.length,
        context:ranked.map(x=>({...x.section,match_reason:x.reason,priority:Math.round(x.score)})),
        local_candidate_events:events.slice(0,45),
        permitted_source_asset_ids:[...new Set(clips.map(c=>c.assetId!))],
        read_saved:true,reused:alreadySaved,bank_revision:s.revision??0,
        note:'Only summaries were loaded. The COMPLETE indexed recording is searchable by calling this tool again with another question or linked IDs. Inspect source transcript/observations, and inspect actual footage for every unresolved visual or audio claim.'}
    },
  },
  {
    name:'record_construction_edit_section',
    description:'After cross-referencing the global bank and inspecting the local editing span, mark ONE local section planned. Keep its context query, source evidence, potential setup/payoffs and proposed cuts in the saved construction. All local sections must be planned before global edit application; this does not itself remove footage.',
    inputSchema:obj({section_id:str('Edit section ID'),
      summary:str('Why the retained moment sequence and any proposed removal preserve context',{minLength:25,maxLength:1600}),
      inspection_ids:list('Actual local audiovisual inspection receipts covering this section',str('Receipt ID'),{minItems:1,maxItems:64})},
      ['section_id','summary','inspection_ids']),
    run:async a=>{
      const s=state()
      if(!s.sections||s.sections.context.some(c=>!c.indexed))throw new Error('Bank the entire original timeline before editing its sections')
      if(s.applied||s.paused)throw new Error('Cannot mark edited or paused sections')
      const id=z.string().trim().min(1).parse(a.section_id)
      const e=s.sections.editing.find(x=>x.id===id)
      if(!e)throw new Error('Unknown local edit section')
      const read=s.sections.reads?.find(x=>x.editSectionId===id)
      if(!read)throw new Error('Query the full global bank for this section with get_construction_edit_context before planning')
      const summary=z.string().trim().min(25).max(1600).parse(a.summary)
      const ids=z.array(z.string()).min(1).max(64).parse(a.inspection_ids)
      const receipts=s.inspections.filter(x=>ids.includes(x.id)&&x.audio&&x.frames.length)
      if(!mergeRanges(receipts).some(r=>r.start<=e.start&&r.end>=e.end))
        throw new Error('Local edit section needs continuous source inspection receipt coverage')
      if(!s.beats.some(b=>b.start<e.end&&e.start<b.end))
        throw new Error('Create a corresponding story beat before certifying a local section edit')
      const next=structuredClone(s),target=next.sections!.editing.find(x=>x.id===id)!
      target.planned=true;target.summary=summary;target.evidenceIds=ids
      target.linkedContextIds=read.bankSectionIds
      await persist(next)
      return {saved:true,edit_section:id,pending_editing:next.sections!.editing.filter(x=>!x.planned).length}
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
    description:'Inspect synchronized timeline pictures, transcript and audio metrics. Overview samples 12 frames over up to 60 seconds and CANNOT justify discarding a discovered event. Focused samples up to 32 frames (including exact priority_frames) from up to 3 seconds; boundary inspects EVERY frame in at most 12 frames. A candidate may require several contiguous focused receipts. Numeric audio metrics are NOT semantic listening.',
    inputSchema:obj({...rangeFields,mode:oneOf('Inspection detail',['overview','focused','boundary']),priority_frames:list('Optional exact trigger frames to see in focused mode, maximum 8',frame,{maxItems:8}),width:int('Separate image width; default 1280, max 1920',{minimum:256,maximum:1920})},['start_frame','end_frame','mode']),
    run:async a=>{
      const s=state(),p=getProject(),fingerprint=constructionFingerprint(p)
      const start=z.number().int().nonnegative().parse(a.start_frame),end=z.number().int().min(start+1).parse(a.end_frame)
      const mode=z.enum(['overview','focused','boundary']).parse(a.mode),width=z.number().int().min(256).max(1920).parse(a.width??1280)
      const permitted=s.applied?mergeRanges(Object.values(p.clips).map(c=>({start:c.start,end:c.start+c.duration}))):s.scope
      if(!permitted.some(r=>start>=r.start && end<=r.end)) throw new Error('Inspection outside permitted timeline ranges')
      if(end-start>(mode==='boundary'?12:mode==='focused'?3*p.settings.fps:60*p.settings.fps)) throw new Error('Inspection too large: boundary maximum 12 frames, focused maximum 3 seconds, overview maximum 60 seconds')
      if(s.inspections.length>=6000) throw new Error('Inspection budget reached; start a focused new pass')
      const priorities=z.array(z.number().int().nonnegative()).max(8).parse(a.priority_frames??[])
      if(priorities.length && mode!=='focused')throw new Error('Exact priority frames are only supported in focused mode')
      if(priorities.some(f=>f<start||f>=end))throw new Error('A requested priority frame lies outside the inspected interval')
      const count=Math.min(mode==='focused'?24:12,end-start)
      const sampled=Array.from({length:count},(_,i)=>mode==='boundary'?start+i:Math.round(start+i*(end-start-1)/Math.max(1,count-1)))
      const frames=[...new Set([...sampled,...priorities])].sort((a,b)=>a-b)
      const images=await timelineStills(p,frames,width)
      const transcript=timelineTranscript(p,start/p.settings.fps,end/p.settings.fps).slice(0,200)
      const audio=await INSPECT_TOOLS.find(t=>t.name==='analyze_audio')!.run({from_seconds:start/p.settings.fps,to_seconds:end/p.settings.fps})
      if(constructionFingerprint(getProject())!==fingerprint || getProject().construction!==s) throw new Error('Project or construction changed during inspection; retry')
      const receipt={id:uid('inspection'),start,end,frames,mode,audio:true,transcript:transcript.length>0}
      const next=structuredClone(s);next.inspections.push(receipt);await persist(next)
      return withImages({inspection_id:receipt.id,frames,fps:p.settings.fps,start_frame:start,end_frame:end,mode,transcript,audio,audio_note:'Audio metrics are not listening: inspect transcript and visual action; mark delivery/game-sound interpretation uncertain unless directly supported.',coverage_note:mode==='overview'?'Sampled overview only; it cannot justify discarding events.':mode==='focused'?'Denser sample of a short interval, including exact requested triggers. It is still not continuous viewing.':'Every frame in this short range is included.'},images.map(c=>({data:canvasBase64(c),mimeType:'image/jpeg' as const})))
    },
  },
  {
    name:'start_construction_indexing',
    description:'Start or resume ONE LOCAL whole-timeline index job. It autonomously scans the entire authorised source timeline in bounded chunks, persists event/scan checkpoints after EACH chunk, and chooses smaller chunks when candidate density is high. The model does NOT need to call scan_construction_events for each minute. The job runs in Lumen while the project stays open and can be stopped by pause_construction_indexing. Get progress with get_construction_indexing. This is candidate indexing only, NOT semantic audiovisual understanding.',
    inputSchema:obj({}),
    run:async()=>{
      const s=state()
      if(missingTimelineTranscripts(getProject()).length)
        throw new Error('Transcribe all audible original timeline media before starting a whole-video index job; do not treat missing transcripts as silence.')
      const scanTool=VIDEO_CONSTRUCTION_TOOLS.find(t=>t.name==='scan_construction_events')!
      const status=startConstructionIndexJob(s,async(start,end)=>{
        const result=await scanTool.run({start_frame:start,end_frame:end})
        return result as {candidates?:unknown[]}
      })
      return {indexing:status,next:'Indexing proceeds locally while Lumen stays open. Inspect get_construction_indexing to view progress. Only complete indexed coverage authorizes the context-bank pass.'}
    },
  },
  {
    name:'get_construction_indexing',
    description:'Read exact currently saved indexing coverage (frames, events, remaining range) and local job state. After a restart there may be no active worker, but partial progress is saved and start_construction_indexing will resume the remaining ranges.',
    inputSchema:obj({}),
    run:async()=>({indexing:constructionIndexProgress(state(false))}),
  },
  {
    name:'pause_construction_indexing',
    description:'Request safe cancellation of LOCAL background indexing. A chunk already rendering may finish before the job pauses. Its durable saved scans remain intact for later resumption. Does not pause the overall story construction unless pause_video_construction is also requested.',
    inputSchema:obj({}),
    run:async()=>({state:pauseConstructionIndexJob(),indexing:constructionIndexProgress(state(false))}),
  },
  {
    name:'scan_construction_events',
    description:'Auto-index up to 60 seconds of ORIGINAL current-timeline footage. Inspects sampled visual frame differences, rendered audio energy changes, timed speech and existing clip boundaries to find CANDIDATE events that need a closer look. No invented highlights, laughter recognition or game understanding. Persists signal provenance and discovery coverage; unresolved candidates block cuts that would delete them. Scan each chunk before final cuts, then inspect promising events individually.',
    inputSchema:obj({...rangeFields},['start_frame','end_frame']),
    run:async a=>{
      const s=state(),p=getProject(),fingerprint=constructionFingerprint(p)
      if(s.applied)throw new Error('Discovery must use the original timeline, before construction applies removals')
      if(s.paused)throw new Error('Resume construction before discovering events')
      const start=z.number().int().nonnegative().parse(a.start_frame),end=z.number().int().min(start+1).parse(a.end_frame)
      const missing=missingTimelineTranscripts(p)
      if(s.discoveryRequired && missing.length)
        throw new Error(`Cannot certify event discovery while these audible timeline assets have no transcript: ${missing.join(', ')}. Transcribe them with transcribe_media first, then scan; audio levels cannot substitute for speech evidence.`)
      const length=end-start
      if(length>60*p.settings.fps)throw new Error('Event discovery max 60 seconds per bounded scan')
      if(!s.scope.some(r=>start>=r.start&&end<=r.end))throw new Error('Discovery range is outside the authorized original timeline')
      const exact=s.discoveryScans?.find(q=>q.start===start&&q.end===end)
      if(exact)return {scan_id:exact.id,reused:true,candidates:(s.discoveryEvents??[]).filter(e=>e.scanId===exact.id),next:'Inspect any candidate that could affect an editorial decision'}
      if(s.discoveryScans?.some(q=>start<q.end&&end>q.start))
        throw new Error('Discovery scans cannot overlap. Use get_video_construction to identify the remaining unscanned interval')
      if((s.discoveryScans?.length??0)>=3000)throw new Error('Discovery scan budget reached')
      // Downsample deliberately: these are search signals, not a claim of watching every frame.
      const step=Math.max(1,Math.round(p.settings.fps/2)),frames:number[]=[]
      for(let f=start;f<end;f+=step)frames.push(f)
      if(frames.at(-1)!==end-1)frames.push(end-1)
      const visuals:{frame:number;score:number}[]=[]
      let prior:Float32Array|null=null
      for(let offset=0;offset<frames.length;offset+=16){
        const window=frames.slice(offset,offset+16),canvases=await timelineStills(p,window,128)
        for(let i=0;i<canvases.length;i++){
          const canvas=canvases[i],ctx=canvas.getContext('2d',{willReadFrequently:true})
          if(!ctx)throw new Error('Cannot measure rendered frame for scene discovery')
          const hsv=toHsv(ctx.getImageData(0,0,canvas.width,canvas.height).data)
          visuals.push({frame:window[i],score:prior?contentDelta(prior,hsv):0})
          prior=hsv
        }
      }
      await prepareAudio(p)
      const mix=await renderMix(p,start/p.settings.fps,end/p.settings.fps,{sampleRate:8000})
      if(Math.abs(mix.duration-length/p.settings.fps)>.002)throw new Error('Discovery mix duration differs from requested timeline range')
      const speech=timelineTranscript(p,start/p.settings.fps,end/p.settings.fps)
      const boundaries=Object.values(p.clips).filter(c=>c.kind==='video'||c.kind==='image')
        .flatMap(c=>[c.start,c.start+c.duration])
        .concat(p.markers.map(m=>m.frame)).filter(f=>f>start&&f<end)
      const found=discoverTimelineEvents({start,end,fps:p.settings.fps,visuals,
        audio:audioIndexBins(levelFrames(mix),start,p.settings.fps),speech,boundaries})
      if(found.length>500)
        throw new Error(`Discovery found ${found.length} distinct candidate events in this interval; split it into smaller non-overlapping windows. It has NOT been marked scanned.`)
      if(constructionFingerprint(getProject())!==fingerprint||getProject().construction!==s)
        throw new Error('Timeline or construction changed during event indexing; retry')
      if((s.discoveryEvents?.length??0)+found.length>10000)throw new Error('Discovery event budget reached; finish the current editorial pass')
      const scanId=uid('discovery_scan')
      const events=found.map(x=>({...x,id:uid('discovery_event'),scanId,
        sourceClipIds:[...new Set(Object.values(p.clips).filter(c=>c.assetId&&c.start<x.end&&c.start+c.duration>x.start)
          .map(c=>c.id))]}))
      const scan={id:scanId,start,end,fingerprint,visualFrames:frames,audioMeasured:true,transcriptLines:speech.length,eventCount:events.length}
      const next=structuredClone(s);next.discoveryScans=[...(next.discoveryScans??[]),scan]
      next.discoveryEvents=[...(next.discoveryEvents??[]),...events]
      if(next.sections && !unscannedDiscoveryRanges(next).length) {
        // The global bank has not begun yet. Repartition from measured candidate
        // boundaries before any context summary or local editing decision exists.
        const hints=next.discoveryEvents!.map(e=>({start:e.start,end:e.end,kind:e.signal,strength:e.strength}))
        const schedule=planConstructionSections(next.scope,next.fps,hints)
        next.sections={
          originalFrames:schedule.totalFrames,
          contextTargetFrames:schedule.contextTargetFrames,editTargetFrames:schedule.editTargetFrames,
          context:schedule.context,editing:schedule.editing,reads:[],
        }
      }
      await persist(next)
      return {scan_id:scanId,start_frame:start,end_frame:end,visual_samples:frames.length,
        audio_metric_bins:Math.round(mix.duration/.2),transcript_lines:speech.length,
        candidates:events,status:constructionStatus(getProject(),next),
        limitation:'Sparse visual sampling, measured audio energy and transcript timing find candidates, NOT all events. Any interval between samples remains unobserved; do not treat a quiet/unchanged score as proof of unimportant footage.'}
    },
  },
  {
    name:'get_discovery_queue',
    description:'Retrieve a small, PRIORITIZED queue of unresolved discovered events. Events inside proposed removals rank first; then audio/visual changes, existing clip boundaries and transcripts. Ranking is an investigation priority only, NEVER a claim that a moment is funny or safe to delete. Use this instead of paging thousands of raw index events.',
    inputSchema:obj({cut_id:str('Optional proposed cut ID; show ONLY unresolved candidates intersecting that cut'),
      offset:int('Queue page offset, default 0',{minimum:0}),
      limit:int('Candidates returned, default 25, max 60',{minimum:1,maximum:60})}),
    run:async a=>{
      const s=state(),offset=z.number().int().min(0).parse(a.offset??0),limit=z.number().int().min(1).max(60).parse(a.limit??25)
      const cutId=z.string().trim().optional().parse(a.cut_id)
      const focus=cutId?s.cuts.find(c=>c.id===cutId):undefined
      if(cutId&&!focus)throw new Error('Unknown cut ID for discovery queue')
      const intersects=(a:{start:number;end:number},b:{start:number;end:number})=>a.start<b.end&&b.start<a.end
      const pending=(s.discoveryEvents??[]).filter(e=>(!e.decision||e.decision==='uncertain')&&(!focus||intersects(e,focus)))
      const ranked=pending.map(e=>{
        const cutIds=s.cuts.filter(c=>intersects(e,c)).map(c=>c.id)
        const base={ 'visual-change':85,'audio-onset':80,'audio-drop':75,'clip-boundary':65,'speech':45 }[e.signal]
        const priority=base+Math.round(20*e.strength)+(cutIds.length?1000:0)
        return {id:e.id,signal:e.signal,start:e.start,end:e.end,priority,cut_ids:cutIds,
          description:e.description,source_clip_ids:e.sourceClipIds,decision:e.decision??'pending',
          note:cutIds.length?'Candidate intersects a planned deletion; review before cutting':'Potential context lead; inspect if it may matter'}
      }).sort((x,y)=>y.priority-x.priority||x.start-y.start)
      return {total:ranked.length,items:ranked.slice(offset,offset+limit),
        next_offset:offset+limit<ranked.length?offset+limit:null,
        note:'Priority measures evidence uncertainty and proposed edit risk, not narrative value or humour. Continue discovery of unscanned timeline ranges in parallel.'}
    },
  },
  {
    name:'review_discovered_events',
    description:'Atomically resolve up to 20 indexed candidates after examining each entire interval. Each decision requires its own real inspection receipt and clear editorial rationale. If any candidate is invalid, none of the decisions are persisted. Helps process busy long-form footage with fewer model/tool calls.',
    inputSchema:obj({decisions:list('Evidence-based candidate reviews',obj({
      event_id:str('Candidate ID'),decision:oneOf('Editorial decision',['keep','discard','uncertain']),
      reason:str('Grounded observation; at least 20 characters'),
      inspection_ids:list('Inspection receipt IDs covering this candidate',str('Receipt ID'),{minItems:1,maxItems:12}),
    },['event_id','decision','reason','inspection_ids']),{minItems:1,maxItems:20})},['decisions']),
    run:async a=>{
      const s=state(),p=getProject()
      if(s.applied||s.paused)throw new Error('Resume pre-edit construction before reviewing original events')
      const schema=z.object({event_id:z.string().trim().min(1),
        decision:z.enum(['keep','discard','uncertain']),
        reason:z.string().trim().min(20).max(1500),inspection_ids:z.array(z.string().min(1)).min(1).max(12)})
      const decisions=z.array(schema).min(1).max(20).parse(a.decisions)
      if(new Set(decisions.map(d=>d.event_id)).size!==decisions.length)throw new Error('Duplicate event in one review batch')
      const next=structuredClone(s),seen:string[]=[]
      for(const decision of decisions) {
        const event=next.discoveryEvents?.find(e=>e.id===decision.event_id)
        if(!event)throw new Error(`Unknown discovery event ${decision.event_id}; no decisions were saved`)
        assertDiscoveryDecisionEvidence(s,event,decision.decision,decision.inspection_ids)
        event.decision=decision.decision;event.decisionReason=decision.reason;event.inspectionIds=decision.inspection_ids
        seen.push(event.id)
      }
      if(constructionFingerprint(p)!==s.fingerprint)throw new Error('Indexed timeline changed; discard this review batch')
      await persist(next)
      return {saved:true,reviewed:seen,remaining:(next.discoveryEvents??[]).filter(e=>!e.decision||e.decision==='uncertain').length}
    },
  },
  {
    name:'review_discovered_event',
    description:'Resolve one event candidate after actually inspecting the surrounding current-timeline footage. Mark keep, discard or uncertain with a specific evidence-based reason; unknown or uncertain events cannot be removed by planned cuts. Discard requires a fresh inspection covering the candidate range. Only use this on pre-apply original timeline.',
    inputSchema:obj({event_id:str('Discovery event ID'),
      decision:oneOf('How this candidate affects the edit',['keep','discard','uncertain']),
      reason:str('Specific evidence-based justification'),
      inspection_ids:list('Real inspect_video_range receipts that cover this event',str('Receipt ID'),{maxItems:12})},
      ['event_id','decision','reason','inspection_ids']),
    run:async a=>{
      const s=state(),p=getProject()
      if(s.applied)throw new Error('Cannot resolve original discovery candidates after editing')
      const eventId=z.string().trim().min(1).parse(a.event_id)
      const decision=z.enum(['keep','discard','uncertain']).parse(a.decision)
      const reason=z.string().trim().min(20).max(1500).parse(a.reason)
      const ids=z.array(z.string().min(1)).max(12).parse(a.inspection_ids)
      const event=s.discoveryEvents?.find(e=>e.id===eventId)
      if(!event)throw new Error('Unknown discovery event ID; retrieve indexed event pages first')
      assertDiscoveryDecisionEvidence(s,event,decision,ids)
      if(constructionFingerprint(p)!==s.fingerprint)throw new Error('Original indexed timeline changed')
      const next=structuredClone(s),target=next.discoveryEvents!.find(e=>e.id===eventId)!
      target.decision=decision;target.decisionReason=reason;target.inspectionIds=ids
      await persist(next)
      return {saved:true,event_id:eventId,decision,
        note:'The decision is a model editorial judgement based on real inspection; a transcript or visual jump alone does not prove any game event or joke.'}
    },
  },
  {
    name:'inspect_construction_audio',
    description:'Capture up to 12 seconds of ACTUAL current timeline mix as a bounded WAV for a selected audio-capable model (Gemini). Use when judgement depends on laughter, delivery, music, or game sounds. Model interpretation is possible only if this WAV reaches an audio-capable model; text-only or unsupported models must not claim to have listened. Uses ONLY current timeline media and saves a source-range receipt.',
    inputSchema:obj({...rangeFields,purpose:str('Which specific audio event or delivery question needs listening')},['start_frame','end_frame','purpose']),
    run:async a=>{
      const s=state(),p=getProject(),fingerprint=constructionFingerprint(p)
      const start=z.number().int().nonnegative().parse(a.start_frame),end=z.number().int().min(start+1).parse(a.end_frame)
      const purpose=z.string().trim().min(1).max(400).parse(a.purpose)
      if(end-start>12*p.settings.fps)throw new Error('Audio listening is limited to 12 seconds per request; inspect a shorter window')
      const permitted=s.applied?mergeRanges(Object.values(p.clips).map(c=>({start:c.start,end:c.start+c.duration}))):s.scope
      if(!permitted.some(r=>start>=r.start&&end<=r.end))throw new Error('Audio capture outside permitted current timeline')
      if((s.audioSamples?.length??0)>=300)throw new Error('Audio sample receipt budget reached')
      await prepareAudio(p)
      const mix=await renderMix(p,start/p.settings.fps,end/p.settings.fps,{sampleRate:24000})
      const expected=(end-start)/p.settings.fps
      if(Math.abs(mix.duration-expected)>Math.max(.001,2/mix.sampleRate))
        throw new Error('Rendered audio length does not match the requested timeline interval; do not attach misleading timestamps')
      const wav=encodeWav(mix),data=base64Bytes(wav)
      if(data.length>4_000_000)throw new Error('Audio exceeds maximum inline payload; use a shorter range')
      if(constructionFingerprint(getProject())!==fingerprint||getProject().construction!==s)
        throw new Error('Timeline or construction changed while capturing audio; retry')
      const sample={id:uid('audio_sample'),start,end,fingerprint,purpose}
      const next=structuredClone(s);next.audioSamples=[...(next.audioSamples??[]),sample]
      await persist(next)
      return withAudio({audio_sample_id:sample.id,start_frame:start,end_frame:end,
        start_seconds:start/p.settings.fps,end_seconds:end/p.settings.fps,purpose,
        audio_format:'audio/wav',audio_seconds:mix.duration,sample_rate:mix.sampleRate,channels:mix.numberOfChannels,
        transcript:timelineTranscript(p,start/p.settings.fps,end/p.settings.fps).slice(0,80),
        limitation:'The WAV carries real rendered audio, but this tool does not itself interpret it. Only an audio-capable receiving model can hear it. Audio cues, laughter, emotion and meaning still require cautious interpretation.'},
        {data,mimeType:'audio/wav'})
    },
  },
  {
    name:'record_construction_audio_observation',
    description:'Record an interpretation AFTER the supplied audio sample has actually been heard by a capable model (or assessed by a human). Distinguish audible cues from guesses, and state uncertainty. Do not call this for text-only agents that only see numeric metrics or transcripts.',
    inputSchema:obj({sample_id:str('Exact captured audio sample receipt ID'),
      event_type:oneOf('Observed kind',['speech_delivery','laughter','game_sound','music','silence','uncertain']),
      summary:str('Short description of perceived sound, not a transcript prediction'),
      audible_cues:str('Concrete acoustic evidence supporting that interpretation'),
      confidence:oneOf('Confidence',['low','medium','high']),
      uncertainty:str('What remains uncertain or ambiguous')},
      ['sample_id','event_type','summary','audible_cues','confidence','uncertainty']),
    run:async a=>{
      const s=state(),p=getProject(),fingerprint=constructionFingerprint(p)
      const raw=z.object({sample_id:z.string().trim().min(1).max(128),
        event_type:z.enum(['speech_delivery','laughter','game_sound','music','silence','uncertain']),
        summary:z.string().trim().min(1).max(2000),
        audible_cues:z.string().trim().min(1).max(2000),
        confidence:z.enum(['low','medium','high']),
        uncertainty:z.string().trim().min(1).max(1500)}).parse(a)
      const sample=s.audioSamples?.find(x=>x.id===raw.sample_id&&x.fingerprint===fingerprint)
      if(!sample)throw new Error('Unknown or stale captured audio sample; inspect real current timeline audio first')
      if((s.audioObservations?.length??0)>=600)throw new Error('Audio observation budget reached')
      const observation={id:uid('audio_observation'),sampleId:sample.id,eventType:raw.event_type,
        summary:raw.summary,audibleCues:raw.audible_cues,confidence:raw.confidence,uncertainty:raw.uncertainty}
      const next=structuredClone(s);next.audioObservations=[...(next.audioObservations??[]),observation]
      await persist(next)
      return {saved:true,observation,note:'Model-reported perception, not objectively verified audio. Cross-check with video, context and any human review.'}
    },
  },
  {
    name:'inspect_cut_context',
    description:'Before accepting an exact removal, retrieve its containing scene, earlier setups, later dependent callbacks, nearby story beats, and the actual timeline transcript on both sides. Saves a context-read receipt tied to the current story map and cut coordinates; never proves that unseen/silent events are unimportant. If speech intersects a boundary, refine the cut and inspect again.',
    inputSchema:obj({cut_id:str('ID of an already proposed cut'),context_seconds:int('Seconds of transcript before/after the cut, default 12, max 60',{minimum:1,maximum:60}),context_query:str('Optional distinctive words describing an event, joke, object or callback to look for elsewhere in footage')},['cut_id']),
    run:async a=>{
      const s=state(),p=getProject(),fingerprint=constructionFingerprint(p)
      if(s.applied) throw new Error('The plan is already applied; review edited joins instead')
      const cutId=z.string().trim().min(1).max(128).parse(a.cut_id)
      const contextSeconds=z.number().int().min(1).max(60).parse(a.context_seconds??12)
      const story=relatedStoryContext(s,cutId)
      const speech=speechCutContext(p,story.cut,contextSeconds)
      const query=z.string().trim().max(240).parse(a.context_query??'')
      const lexicalCandidates=transcriptCallbackCandidates(p,story.cut,query || [story.focus.summary,story.cut.reason].join(' '))
      const storySignature=constructionStorySignature(s)
      if(constructionFingerprint(getProject())!==fingerprint || getProject().construction!==s) throw new Error('Project or story map changed during context retrieval; retry')
      if(speech.violations.length) return {story,speech,lexicalCandidates,recorded:false,safe_to_apply:false,next:'Speech crosses a proposed boundary. Refine the frames, inspect actual audio and retrieve context again.'}
      const next=structuredClone(s)
      next.contextInspections=[...(next.contextInspections??[]).filter(r=>r.cutId!==cutId),{cutId,storySignature}]
      await persist(next)
      return {story,speech,lexicalCandidates,recorded:true,safe_to_apply:'No transcribed phrase crosses an edge; untranscribed speech or sounds are still unverified',
        recommended_inspection_ranges:[story.focus,...story.dependencies,...story.related].map(b=>({beat_id:b.id,start_frame:b.start,end_frame:b.end})).slice(0,80),
        note:'Explicit story links and lexical transcript matches are retrieval clues only, not evidence that a callback is present. This receipt certifies context was retrieved, not that a model understood every setup, joke or reaction. Inspect relevant audio and video, refine protected moments and make a deliberate editorial judgement.'}
    },
  },
  {
    name:'next_event_probe',
    description:'Plan a frame-exact bisection probe for a single bracketed visual state change. First inspect both endpoints. Use only when the interval has one change; for repeats or unknown behaviour scan shorter windows instead. It plans the next frame and does not observe the event itself.',
    inputSchema:obj({left_frame:frame,right_frame:frame,left_present:bool('Observed state at left'),right_present:bool('Observed state at right'),single_change:bool('The inspected interval supports one change, not repeated appearances')},['left_frame','right_frame','left_present','right_present','single_change']),
    run:async a=>nextEventProbe(z.number().parse(a.left_frame),z.number().parse(a.right_frame),z.boolean().parse(a.left_present),z.boolean().parse(a.right_present),z.boolean().parse(a.single_change)),
  },
  {
    name:'record_construction_narrative_moments',
    description:'Build a durable, factual timeline of IMPORTANT story events and causal links from inspected original footage. Use after context banking to record challenge rules, round/night starts and endings, actual joke setups/payoffs, callbacks, discoveries, failures and reactions. Each event has exact source frames, inspector evidence, direct/uncertain confidence and explicit dependencies. Essential moments must survive the final EDL, and essential payoffs must follow their setup even if previewed earlier as a hook.',
    inputSchema:obj({moments:list('Source-grounded narrative events with explicit relationships',obj({
      id:str('Stable moment ID'),
      start_frame:frame,end_frame:frame,
      kind:oneOf('Verified moment type',['premise','rule','round-start','round-end','objective','discovery','joke-setup','joke-payoff','callback','reaction','failure','success','ending','other']),
      importance:oneOf('Editorial importance',['essential','supporting','optional']),
      confidence:oneOf('Direct evidence or remaining uncertainty',['observed','uncertain']),
      description:str('Observed fact at this exact source interval; no invented game events',{minLength:15,maxLength:2000}),
      inspection_ids:list('Actual original timeline audiovisual inspection receipts',str('Receipt ID'),{minItems:1,maxItems:40}),
      links:list('Necessary causal/continuity links to other moment IDs',obj({
        moment_id:str('Prior or related event ID'),relation:oneOf('Relationship',['requires','answers','consequence','callback']),
      },['moment_id','relation']),{maxItems:15}),
    },['id','start_frame','end_frame','kind','importance','confidence','description','inspection_ids','links']),{minItems:1,maxItems:20})},['moments']),
    run:async args=>{
      const stateBefore=state()
      if(stateBefore.applied||stateBefore.paused||!stateBefore.sourceManifest)
        throw new Error('Record original source narrative moments before publishing the output')
      const schema=z.array(z.object({id:z.string().trim().min(1).max(128),
        start_frame:z.number().int().nonnegative(),end_frame:z.number().int().positive(),
        kind:z.enum(['premise','rule','round-start','round-end','objective','discovery','joke-setup','joke-payoff','callback','reaction','failure','success','ending','other']),
        importance:z.enum(['essential','supporting','optional']),confidence:z.enum(['observed','uncertain']),
        description:z.string().trim().min(15).max(2000),
        inspection_ids:z.array(z.string().min(1)).min(1).max(40),
        links:z.array(z.object({moment_id:z.string().min(1),relation:z.enum(['requires','answers','consequence','callback'])})).max(15),
      })).min(1).max(20).parse(args.moments)
      const out=new Map((stateBefore.narrativeMoments??[]).map(x=>[x.id,x]))
      if(new Set(schema.map(x=>x.id)).size!==schema.length)throw new Error('Duplicate moment ID in one batch')
      for(const item of schema){
        const moment={id:item.id,start:item.start_frame,end:item.end_frame,kind:item.kind,
          importance:item.importance,confidence:item.confidence,description:item.description,
          evidenceIds:item.inspection_ids,links:item.links.map(link=>({
            momentId:link.moment_id,relation:link.relation,
          }))}
        validateNarrativeMoment(stateBefore,moment)
        out.set(moment.id,moment)
      }
      if(out.size>2500)throw new Error('Narrative memory budget exceeded; use shorter complete source episodes')
      const changed=JSON.stringify([...out.values()])!==JSON.stringify(stateBefore.narrativeMoments??[])
      if(changed){const next=structuredClone(stateBefore);next.narrativeMoments=[...out.values()];await persist(next)}
      return {saved:changed,reused:!changed,total:out.size,
        note:'Every entry is a model/inspector-grounded claim, not inferred from game research. Essential events and linked setups are mechanically protected by the keep-first EDL validator.'}
    },
  },
  {
    name:'record_keep_first_selections',
    description:'Select ORIGINAL timeline moments for a NEW video in intentional output order. Upsert up to 30 per call using real inspected time ranges, story beats and provenance; never add media. Keep entire jokes, setups, payoffs and the ending. This plans a reversible edit; it does NOT remove source footage.',
    inputSchema:obj({selections:list('Source-backed selections',obj({
      id:str('Stable source selection ID'),start_frame:frame,end_frame:frame,
      output_order:int('Position in final output, 0 based; globally unique',{minimum:0}),
      role:oneOf('Editorial role',['hook','setup','scene','escalation','payoff','callback','ending','complete']),
      beat_id:str('Grounded original story beat ID'),
      reason:str('Why this moment belongs in the video',{minLength:20,maxLength:2000}),
      inspection_ids:list('Real original audiovisual inspection receipt IDs',str('Receipt ID'),{minItems:1,maxItems:64}),
    },['id','start_frame','end_frame','output_order','role','beat_id','reason','inspection_ids']),{minItems:1,maxItems:30}),
      remove_ids:list('Obsolete selection IDs to remove',str('ID'),{maxItems:100})},['selections']),
    run:async args=>{
      const s=state()
      if(s.applied||s.paused||!s.sourceManifest)throw new Error('Original source selection must be active and not yet published')
      if(s.sections?.context.some(c=>!c.indexed)||s.sections?.editing.some(c=>!c.planned))
        throw new Error('Complete whole-video context and local section editing plans before selecting the final sequence')
      const input=z.array(z.object({id:z.string().trim().min(1).max(128),
        start_frame:z.number().int().nonnegative(),end_frame:z.number().int().positive(),
        output_order:z.number().int().nonnegative(),
        role:z.enum(['hook','setup','scene','escalation','payoff','callback','ending','complete']),
        beat_id:z.string().trim().min(1),reason:z.string().trim().min(20).max(2000),
        inspection_ids:z.array(z.string().min(1)).min(1).max(64)})).min(1).max(30).parse(args.selections)
      const removed=z.array(z.string()).max(100).parse(args.remove_ids??[])
      if(new Set(input.map(x=>x.id)).size!==input.length)throw new Error('Duplicate selection in batch')
      const old=(s.sourceSelections??[]).filter(x=>!removed.includes(x.id))
      const nextItems=new Map(old.map((x,i)=>[x.id,{...x,outputOrder:x.outputOrder??i}]))
      for(const x of input){
        if(x.end_frame<=x.start_frame||!s.scope.some(r=>x.start_frame>=r.start&&x.end_frame<=r.end))
          throw new Error('Selection cannot use empty or unauthorised timeline footage')
        if(!s.beats.some(b=>b.id===x.beat_id&&b.start<x.end_frame&&x.start_frame<b.end))
          throw new Error('Selection must overlap a verified story beat')
        const seen=s.inspections.filter(i=>x.inspection_ids.includes(i.id)&&i.audio&&i.frames.length)
        if(!mergeRanges(seen).some(r=>r.start<=x.start_frame&&r.end>=x.end_frame))
          throw new Error('Selected original footage needs actual audiovisual inspection covering its full range')
        nextItems.set(x.id,{id:x.id,start:x.start_frame,end:x.end_frame,role:x.role,
          beatId:x.beat_id,reason:x.reason,evidenceIds:x.inspection_ids,outputOrder:x.output_order})
      }
      const sorted=[...nextItems.values()].sort((a,b)=>a.outputOrder-b.outputOrder||a.id.localeCompare(b.id))
      if(new Set(sorted.map(x=>x.outputOrder)).size!==sorted.length)
        throw new Error('Every selected moment must have a unique output_order')
      const next=structuredClone(s);next.sourceSelections=sorted
      await persist(next)
      return {saved:true,source_sections:sorted.length,
        ordered:sorted.map(x=>({id:x.id,start_frame:x.start,end_frame:x.end,role:x.role})).slice(0,100),
        next:'Preview the exact source map before publishing the new editable sequence.'}
    },
  },
  {
    name:'preview_keep_first_assembly',
    description:'Validate proposed source selections without changing any footage. Checks timeline permissions, protected events, source evidence, necessary earlier setups and final story order. Returns original-to-output frame mapping and precise timing.',
    inputSchema:obj({name:str('Optional new sequence name')}),
    run:async a=>{
      const s=state()
      const out=composeKeepFirstSequence(getProject(),s,typeof a.name==='string'?a.name:undefined)
      validateOutputSourceMap(out,s.sourceManifest!)
      return {valid:true,name:out.sequence.name,original_sequence_id:s.sourceManifest!.sequenceId,
        selected_segments:out.selections,output_frames:out.outputFrames,
        original_frames:out.originalFrames,join_frames:out.joins,
        preserved_clips:out.clips.length,source_map_preview:out.clips.slice(0,20),
        note:'A structurally verified assembly is not proof of humour, watchability or smooth audio. Publish only after narrative verification and review the output.'}
    },
  },
  {
    name:'publish_keep_first_assembly',
    description:'Atomically publish the validated, keep-first source selections to a NEW editable timeline. Keep the entire ORIGINAL authorised timeline intact as another sequence. Save original clip identities, effects, group links and exact frame mappings. Publishing is one undo step; then inspect the real output and its joins before claiming completion.',
    inputSchema:obj({name:str('Optional assembled sequence name')}),
    run:async a=>{
      const s=state()
      validateKeepFirstSelections(getProject(),s)
      const result=dispatch('construction.publishSelection',{
        ...(typeof a.name==='string'?{name:a.name}:{}),
      },{source:'ai'})
      if(!result.ok)throw new Error(result.error)
      if(!await saveProject())throw new Error('Output was created in memory but saving failed. Save the project before continuing.')
      const published=state(false)
      return {published:true,...(result.result as Record<string,unknown>),
        status:constructionStatus(getProject(),published),
        note:'Original footage is preserved in the original sequence; the new output timeline is open for post-edit review and can be undone as a single operation.'}
    },
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
      const next=structuredClone(s);next.applied={fingerprint:constructionFingerprint(getProject()),joins};next.inspections=[];next.joinAudioChecks=[];next.review=undefined
      await persist(next)
      return {applied:true,joins,removed_frames:removed,status:'review-required',undoable:true}
    },
  },
  {
    name:'inspect_construction_join_audio',
    description:'Measure the ACTUAL rendered timeline mix around one post-edit join, at sample resolution. Returns possible click and abrupt-level-shift warnings plus adjacent transcribed speech; measurements are not semantic listening. Saves the evidence in the project and must be run for each join before final review.',
    inputSchema:obj({join_frame:frame},['join_frame']),
    run:async a=>{
      const s=state(),p=getProject(),fingerprint=constructionFingerprint(p)
      if(!s.applied) throw new Error('Apply the construction before inspecting its resulting joins')
      const join=z.number().int().nonnegative().parse(a.join_frame)
      if(!s.applied.joins.includes(join)) throw new Error('Unknown join; use get_video_construction to see exact join frames')
      const fps=p.settings.fps
      const duration=Math.max(0,...Object.values(p.clips).map(c=>c.start+c.duration))/fps
      const at=join/fps,from=Math.max(0,at-.5),to=Math.min(duration,at+.5)
      if(to<=from) throw new Error('Empty join audio window')
      await prepareAudio(p)
      const mix=await renderMix(p,from,to)
      const index=Math.round((at-from)*mix.sampleRate)
      const report=index>=1 && index<mix.length
        ? assessJoinAudio(Array.from({length:mix.numberOfChannels},(_,i)=>mix.getChannelData(i)),mix.sampleRate,index)
        : null
      if(constructionFingerprint(getProject())!==fingerprint || getProject().construction!==s) throw new Error('Timeline or construction changed during audio rendering; retry')
      const next=structuredClone(s)
      next.joinAudioChecks=[...(next.joinAudioChecks??[]).filter(x=>x.frame!==join),
        {frame:join,fingerprint,report}]
      // New evidence cannot silently inherit an old editorial verdict.
      next.review=undefined
      await persist(next)
      return {join_frame:join,from_seconds:from,to_seconds:to,report,
        transcript:timelineTranscript(p,Math.max(0,at-3),at+3).slice(0,80),
        saved:true,limitations:'PCM levels and timed transcripts are not perception of laughter, delivery, gameplay meaning or intentional sound design. No waveform anomaly is definitive; suspicious joins require editorial evaluation.'}
    },
  },
  {
    name:'reopen_construction_source_for_repair',
    description:'After a published keep-first output FAILS its actual video review, reopen the untouched authorised ORIGINAL timeline and restore all original inspector receipts, context bank, beats and selected EDL. Keep the earlier output as a separate sequence. Then revise selected spans and publish a NEW version, without needing to re-index the whole source. This is one undoable editor transaction.',
    inputSchema:obj({}),
    run:async()=>{
      const s=state()
      if(!s.assembly||!s.review?.issues.length)
        throw new Error('This recovery route needs a published keep-first assembly and a completed review identifying real issues')
      const result=dispatch('construction.restoreSourceForRepair',{}, {source:'ai'})
      if(!result.ok)throw new Error(result.error)
      if(!await saveProject())throw new Error('Original source was reopened in memory, but the project save failed. Save before further edits.')
      const restored=state(false)
      return {reopened:true,...result.result as Record<string,unknown>,
        status:constructionStatus(getProject(),restored),
        note:'All original footage, verified source receipts, and cross-video context remain available. The old output is preserved. Adjust selected moments, preview again and publish the next corrected version.'}
    },
  },
  {
    name:'begin_construction_repair',
    description:'Start a fresh bounded editorial pass on the CURRENT edited timeline after review found real problems. Keeps the previous failing join frames and issue explanations as repair context; never restores deleted footage or secretly changes source selection. Requires an unfinished review with unresolved issues.',
    inputSchema:obj({goal:str('Specific repair objective for failed joins or continuity')},['goal']),
    run:async a=>{
      const previous=state()
      if(!previous.applied || !previous.review?.issues.length) throw new Error('A completed review with unresolved problems is required before repair')
      const depth=(previous.repairOf?.depth??0)+1
      if(depth>3) throw new Error('Three repair passes attempted; leave the project for deliberate manual assessment rather than looping forever')
      const p=getProject()
      const goal=z.string().trim().min(1).max(2000).parse(a.goal)
      const next=beginConstruction(p,goal,true)
      const targeted=previous.review.joinVerdicts?.filter(v=>v.verdict==='repair').map(v=>v.frame)
      next.repairOf={fingerprint:previous.applied.fingerprint,
        targetFrames:targeted?.length ? targeted : previous.applied.joins,
        issues:[...previous.review.issues].slice(0,100),depth}
      await persist(next)
      return {status:constructionStatus(getProject(),next),repairOf:next.repairOf,
        note:'Re-map current timeline content and inspect affected joins before deciding a fix. Removed source material remains excluded; do not add clips from outside the timeline.'}
    },
  },
  {
    name:'audit_assembled_source_map',
    description:'Independent deterministic audit of the ACTUAL open assembled output, not the AI editor explanation. Verify original source preserved, selected clip identity, precise source in-points, output order, lengths, track routing and missing/unmapped clips. Does not judge whether a joke is funny or a scene is watchable.',
    inputSchema:obj({}),
    run:async()=>{
      const s=state()
      if(!s.assembly)throw new Error('Only a published keep-first sequence has a verifiable original source map')
      return auditPublishedAssembly(getProject(),s)
    },
  },
  {
    name:'review_video_construction',
    description:'Record a post-edit review after inspecting the actual new joins and whole output. Completion requires every join inspected, sampled audiovisual coverage of the output, explicit story/pacing findings, no unresolved issues and no structural errors. Findings are model judgements, not proof of human-quality editing.',
    inputSchema:obj({story:str('Can a new viewer understand the progression, setups and payoffs?'),pacing:str('Assess internal scene rhythm, necessary silence and transitions'),issues:list('Unresolved problems; empty only if checks passed',str('Problem'),{maxItems:100}),join_verdicts:list('Explicit decision for each flagged audio join; accept only with evidence from the actual scene',obj({frame,verdict:oneOf('Join decision',['accept','repair']),reason:str('Specific rationale explaining intentionality or defect',{minLength:20})},['frame','verdict','reason']),{maxItems:100})},['story','pacing','issues']),
    run:async a=>{
      const s=state();if(!s.applied) throw new Error('Apply the plan before reviewing its output')
      const findings=z.object({story:z.string().trim().min(1).max(4000),pacing:z.string().trim().min(1).max(4000),issues:z.array(z.string().min(1).max(1000)).max(100),
        join_verdicts:z.array(z.object({frame:z.number().int().nonnegative(),verdict:z.enum(['accept','repair']),reason:z.string().trim().min(20).max(1500)})).max(100).default([])}).parse(a)
      const p=getProject(),ranges=mergeRanges(Object.values(p.clips).map(c=>({start:c.start,end:c.start+c.duration})))
      const inspected=mergeRanges(s.inspections.filter(i=>i.audio&&i.frames.length).map(i=>({start:i.start,end:i.end})))
      if(ranges.some(r=>!inspected.some(i=>i.start<=r.start&&i.end>=r.end))) throw new Error('Inspect the whole output in bounded audiovisual windows before final review')
      const frames=new Set(s.inspections.flatMap(i=>i.frames))
      for(const join of s.applied.joins) for(const f of [join-1,join,join+1]) if(ranges.some(r=>f>=r.start&&f<r.end)&&!frames.has(f)) throw new Error(`Inspect neighbouring frames at edited join ${join}`)
      const fingerprint=constructionFingerprint(p)
      const checks=s.joinAudioChecks??[]
      for(const join of s.applied.joins) if(!checks.some(c=>c.frame===join && c.fingerprint===fingerprint))
        throw new Error(`Inspect actual mixed audio at edited join ${join} before final review`)
      if(new Set(findings.join_verdicts.map(v=>v.frame)).size!==findings.join_verdicts.length)
        throw new Error('Duplicate audio join verdict')
      const flagged=checks.filter(c=>c.fingerprint===fingerprint && c.report?.flags.some(f=>f!=='silent-or-unverifiable'))
      for(const c of flagged) if(!findings.join_verdicts.some(v=>v.frame===c.frame))
        throw new Error(`Give a reasoned accept/repair verdict for flagged audio join ${c.frame}`)
      if(findings.join_verdicts.some(v=>!s.applied!.joins.includes(v.frame)))
        throw new Error('Verdict refers to unknown join')
      const quality=assessVideoQuality(p,defaultVideoBrief('gaming-highlights'))
      const sourceAudit=s.assembly?auditPublishedAssembly(p,s):null
      const issues=[...findings.issues,...(sourceAudit?.issues??[]),
        ...findings.join_verdicts.filter(v=>v.verdict==='repair').map(v=>`Audio join ${v.frame} needs repair: ${v.reason}`),
        ...quality.findings.filter(f=>f.severity==='error').map(f=>f.message)]
      const next=structuredClone(s);next.review={story:findings.story,pacing:findings.pacing,issues,joinVerdicts:findings.join_verdicts,joins:s.applied.joins,fingerprint};await persist(next)
      return {status:constructionStatus(p,next),quality,sourceAudit}
    },
  },
]

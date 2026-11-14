/** A stateful editorial workflow over the existing frame-based editor. */
import { z } from 'zod'
import { beginConstruction, constructionFingerprint, constructionStatus, constructionStorySignature, mergeRanges, nextEventProbe, updateConstruction, validateConstructionCuts, type ConstructionState } from '@/editor/video-construction'
import { dispatch, getProject, recordVideoConstruction, rollbackTo, savepoint, useEditor } from '@/editor/store'
import { timelineTranscript } from '@/editor/smart'
import { assertSpeechSafeCuts, relatedStoryContext, speechCutContext, transcriptCallbackCandidates } from '@/editor/construction-context'
import { assessVideoQuality, defaultVideoBrief } from '@/editor/video-quality'
import { assessJoinAudio } from '@/editor/construction-join-audio'
import { prepareAudio, renderMix } from '@/engine/audio-engine'
import { encodeWav } from '@/engine/wav'
import { timelineStills, canvasBase64 } from '@/engine/stills'
import { saveProject, useSession } from '@/project/session'
import { INSPECT_TOOLS } from './inspect'
import { bool, int, list, obj, oneOf, str, withAudio, withImages, type AgentTool } from './kit'
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
      return {goal:s.goal,fps:s.fps,status:{...status,uncovered:status.uncovered.slice(0,100),uncovered_count:status.uncovered.length},scope:page(s.scope),beats:page(s.beats),coverage:page(s.coverage),cuts:page(s.cuts),inspections:page(s.inspections),contextInspections:page(s.contextInspections??[]),audioSamples:page(s.audioSamples??[]),audioObservations:page(s.audioObservations??[]),joinAudioChecks:page(s.joinAudioChecks??[]),repairOf:s.repairOf,applied:s.applied,review:s.review}
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
      const next=beginConstruction(p,goal)
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
      const issues=[...findings.issues,
        ...findings.join_verdicts.filter(v=>v.verdict==='repair').map(v=>`Audio join ${v.frame} needs repair: ${v.reason}`),
        ...quality.findings.filter(f=>f.severity==='error').map(f=>f.message)]
      const next=structuredClone(s);next.review={story:findings.story,pacing:findings.pacing,issues,joinVerdicts:findings.join_verdicts,joins:s.applied.joins,fingerprint};await persist(next)
      return {status:constructionStatus(p,next),quality}
    },
  },
]

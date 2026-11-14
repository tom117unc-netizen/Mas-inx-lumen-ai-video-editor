import { beforeEach, expect, it, vi } from 'vitest'
import type { Project } from '@/editor/types'
vi.mock('@/engine/stills',()=>({timelineStills:async(_p:Project,frames:number[],width:number)=>frames.map((f)=>({
 width,height:Math.round(width*9/16),
 getContext:()=>({getImageData:()=>{const data=new Uint8ClampedArray(width*Math.round(width*9/16)*4)
  // Contrasting scene after 3 seconds; no claim that this is a meaningful event.
  for(let i=0;i<data.length;i+=4){const v=f>=90?255:0;data[i]=v;data[i+1]=v;data[i+2]=v;data[i+3]=255}
  return {data}}}),
})),canvasBase64:()=> 'image',contactSheet:()=>({}),mediaStills:()=>[]}))
vi.mock('@/project/session',()=>({useSession:{getState:()=>({path:'/test.lumen'})},saveProject:async()=>true,isDirty:()=>false}))
const audioMock=vi.hoisted(()=>({click:false}))
vi.mock('@/engine/audio-engine',async original=>({...await original<typeof import('@/engine/audio-engine')>(),prepareAudio:async()=>{},renderMix:async(_p:Project,from:number,to:number,opts?:{sampleRate?:number})=>{
 const rate=opts?.sampleRate??48000, length=Math.max(1,Math.round((to-from)*rate))
 const d=new Float32Array(length)
 if(audioMock.click){d.fill(.35,0,Math.floor(length/2));d.fill(-.65,Math.floor(length/2))}
 return {sampleRate:rate,length,duration:length/rate,numberOfChannels:1,getChannelData:()=>d}
}}))
const { VIDEO_CONSTRUCTION_TOOLS }=await import('./video-construction')
const { useEditor,getProject,dispatch }=await import('@/editor/store')
const { createEmptyProject }=await import('@/editor/new-project')
const { createClip }=await import('@/editor/defaults')
const run=(name:string,args:Record<string,unknown>={})=>VIDEO_CONSTRUCTION_TOOLS.find(t=>t.name===name)!.run(args)
beforeEach(()=>{
 audioMock.click=false
 const p=createEmptyProject('Video');const c=createClip({kind:'video',trackId:p.tracks[0].id,start:0,duration:300});p.clips[c.id]=c;useEditor.getState().loadProject(p)
})
/** The mock video switches visually near 3s. This helper exercises the NEW
 * required scan, then closely examines candidate intervals crossing a cut. */
async function discoverBeforeCut(start:number,end:number){
 const scan=await run('scan_construction_events',{start_frame:0,end_frame:300}) as any
 for(const candidate of scan.candidates as any[]){
  if(candidate.start>=end||candidate.end<=start)continue
  const receipts:string[]=[]
  for(let at=candidate.start;at<candidate.end;at+=90){
    const until=Math.min(candidate.end,at+90)
    const view=await run('inspect_video_range',{start_frame:at,end_frame:until,mode:'focused',
      priority_frames:candidate.visualFrames.filter((f:number)=>f>=at&&f<until)}) as any
    receipts.push(view.json.inspection_id)
  }
  await run('review_discovered_event',{event_id:candidate.id,decision:'discard',
    reason:'Inspected each targeted mock scene interval; safe to tighten this redundant fixture section.',
    inspection_ids:receipts})
 }
 return scan
}
/** Full bank precedes all local editing decisions, and the actual timeline
 * overview from the existing scenario supplies both section evidence packs. */
async function completeTwoPassSections(inspectionId:string){
 const before=getProject().construction?.sections
 expect(before?.context.length).toBeGreaterThan(0)
 for(const context of before!.context){
  await run('record_construction_context_section',{
   section_id:context.id,
   summary:'Actual inspected gameplay section: establish local actions and the reaction, with no unsupported interpretation of silent activity.',
   key_moments:['Scene state changes in the rendered mock gameplay'],
   uncertainties:['Mock visual change has no human-verified semantic game meaning'],
   inspection_ids:[inspectionId],
  })
 }
 const next=getProject().construction!.sections!
 for(const edit of next.editing){
  const linked=await run('get_construction_edit_context',{section_id:edit.id,
   question:'What earlier story setup and later reaction can affect these cuts?'}) as any
  expect(linked.context.length).toBeGreaterThan(0)
  await run('record_construction_edit_section',{
   section_id:edit.id,
   summary:'This deliberately short test section retains the local setup/reaction map and any proposed removal is gated by cross-video context.',
   inspection_ids:[inspectionId],
  })
 }
}
it('registers a resumable workflow and marks project dirty without changing clips',async()=>{
 const before=structuredClone(getProject().clips),v=useEditor.getState().version
 await run('begin_video_construction',{goal:'Funny story'})
 expect(getProject().clips).toEqual(before);expect(useEditor.getState().version).toBeGreaterThan(v)
 const reloaded=JSON.parse(JSON.stringify(getProject()));useEditor.getState().loadProject(reloaded)
 expect(await run('get_video_construction')).toMatchObject({status:{stage:'discover'}})
})
it('returns only bounded checkpoint counts without loading the full editorial ledger',async()=>{
 await run('begin_video_construction',{goal:'Reconstruct YapYap from current source only'})
 const summary=await run('get_construction_checkpoint') as any
 expect(summary.goal).toContain('YapYap')
 expect(summary.status.stage).toBe('discover')
 expect(summary.status.uncovered.length).toBeLessThanOrEqual(3)
 expect(summary.discoveryScans).toEqual({total:0})
 expect(summary.inspections).toEqual({total:0})
 expect(summary.sectionPlan.pending_context).toBeGreaterThan(0)
 expect(summary).not.toHaveProperty('scope')
 expect(summary).not.toHaveProperty('coverage')
})
it('inspects exact neighbouring frames separately with synchronized transcript/audio metadata',async()=>{
 await run('begin_video_construction',{goal:'Story'})
 const result=await run('inspect_video_range',{start_frame:99,end_frame:102,mode:'boundary'}) as any
 expect(result.images).toHaveLength(3)
 expect(result.json.frames).toEqual([99,100,101])
 expect(result.json.audio_note).toMatch(/not.*listen/i)
 expect(getProject().construction?.inspections[0].frames).toEqual([99,100,101])
})
it('blocks unsampled cuts and applies verified cuts in one undo step',async()=>{
 await run('begin_video_construction',{goal:'Story'})
 await discoverBeforeCut(100,200)
 const scan=await run('inspect_video_range',{start_frame:0,end_frame:300,mode:'overview'}) as any
 const first=await run('inspect_video_range',{start_frame:99,end_frame:102,mode:'boundary'}) as any
 const last=await run('inspect_video_range',{start_frame:199,end_frame:202,mode:'boundary'}) as any
 await run('update_video_construction',{coverage:[{id:'all',start:0,end:300,visual:'Checked footage',audio:'Checked sound context',evidenceIds:[scan.json.inspection_id]}],beats:[{id:'scene',start:0,end:300,kind:'scene',summary:'Approach and reaction',dependsOn:[],protectedRanges:[]}],cuts:[{id:'cut',start:100,end:200,beatId:'scene',reason:'Repeated waiting',visualReason:'No new action',audioReason:'No line lost',evidenceIds:[scan.json.inspection_id,first.json.inspection_id,last.json.inspection_id]}]})
 await completeTwoPassSections(scan.json.inspection_id)
 const before=structuredClone(getProject().clips),undo=useEditor.getState().past.length
 await expect(run('apply_video_construction')).rejects.toThrow(/context/i)
 expect(await run('inspect_cut_context',{cut_id:'cut'})).toMatchObject({recorded:true})
 expect(await run('apply_video_construction')).toMatchObject({applied:true,joins:[100]})
 expect(Math.max(...Object.values(getProject().clips).map(c=>c.start+c.duration))).toBe(200)
 expect(useEditor.getState().past).toHaveLength(undo+1)
 expect(await run('get_video_construction')).toMatchObject({status:{stage:'review',complete:false}})
 await expect(run('apply_video_construction')).rejects.toThrow(/applied/)
 useEditor.getState().undo();expect(getProject().clips).toEqual(before)
 expect(await run('get_video_construction')).toMatchObject({status:{stage:'stale'}})
})
it('refuses stale plans after a manual change',async()=>{
 await run('begin_video_construction',{goal:'Story'})
 const c=Object.values(getProject().clips)[0];dispatch('clip.trim',{id:c.id,edge:'end',frame:250})
 await expect(run('update_video_construction',{beats:[]})).rejects.toThrow(/stale|changed/)
})
it('rejects oversized boundary requests before decoding',async()=>{
 await run('begin_video_construction',{goal:'Story'})
 await expect(run('inspect_video_range',{start_frame:0,end_frame:300,mode:'boundary'})).rejects.toThrow(/12|bound/i)
})
it('requires actual output inspection before recording a successful review',async()=>{
 await run('begin_video_construction',{goal:'Story'})
 await discoverBeforeCut(100,200)
 // Use the live flow to generate receipts, not model-supplied evidence.
 const ids=[]
 for(const [start,end,mode] of [[0,300,'overview'],[99,102,'boundary'],[199,202,'boundary']] as const) {
  const r=await run('inspect_video_range',{start_frame:start,end_frame:end,mode}) as any;ids.push(r.json.inspection_id)
 }
 await run('update_video_construction',{coverage:[{id:'all',start:0,end:300,visual:'Checked',audio:'Checked',evidenceIds:[ids[0]]}],beats:[{id:'scene',start:0,end:300,kind:'scene',summary:'Scene'}],cuts:[{id:'c',start:100,end:200,beatId:'scene',reason:'Repeated action',audioReason:'No line lost',visualReason:'No action lost',evidenceIds:ids}]})
 await completeTwoPassSections(ids[0])
 await run('inspect_cut_context',{cut_id:'c'})
 await run('apply_video_construction')
 await expect(run('review_video_construction',{story:'Clear',pacing:'Good',issues:[]})).rejects.toThrow(/whole output/i)
 await run('inspect_video_range',{start_frame:0,end_frame:200,mode:'overview'})
 await expect(run('review_video_construction',{story:'Clear',pacing:'Good',issues:[]})).rejects.toThrow(/join/i)
 await run('inspect_video_range',{start_frame:99,end_frame:102,mode:'boundary'})
 await expect(run('review_video_construction',{story:'Setup and payoff remain',pacing:'Good',issues:[]})).rejects.toThrow(/audio/i)
 const evidence=await run('inspect_construction_join_audio',{join_frame:100}) as any
 expect(evidence.saved).toBe(true)
 expect(evidence.report.flags).toContain('silent-or-unverifiable')
 expect(await run('review_video_construction',{story:'Setup and payoff remain',pacing:'Waiting shortened without losing reaction',issues:[]})).toMatchObject({status:{complete:true}})
 // A risky join cannot silently pass review; the model must explicitly assess it.
 audioMock.click=true
 const risk=await run('inspect_construction_join_audio',{join_frame:100}) as any
 expect(risk.report.flags).toContain('possible-click')
 expect(await run('get_video_construction')).toMatchObject({status:{stage:'review',complete:false}})
 await expect(run('review_video_construction',{story:'Fine',pacing:'Fine',issues:[]})).rejects.toThrow(/verdict/i)
 const join_verdicts=[{frame:100,verdict:'accept',reason:'A deliberately abrupt cut at the on-screen impact, justified by the inspected action and timing.'}]
 expect(await run('review_video_construction',{story:'The impact stays clear',pacing:'The hard edit is deliberate',issues:[],join_verdicts})).toMatchObject({status:{complete:true}})
 expect(await run('review_video_construction',{story:'Callback missing',pacing:'Transition disrupts the story',issues:['The callback setup needs another inspection'],join_verdicts})).toMatchObject({status:{complete:false}})
 const repaired=await run('begin_construction_repair',{goal:'Fix the callback continuity within the current timeline'}) as any
 expect(repaired.repairOf).toMatchObject({depth:1,targetFrames:[100]})
 expect(getProject().construction?.applied).toBeUndefined()
 expect(await run('get_video_construction')).toMatchObject({status:{stage:'discover'},repairOf:{depth:1}})
})
it('reports an unsafe cut through available speech instead of issuing a receipt',async()=>{
 const p=createEmptyProject('Dialogue')
 const c=createClip({kind:'video',trackId:p.tracks[0].id,start:0,duration:300,assetId:'source'})
 p.clips[c.id]=c
 p.assets.source={id:'source',name:'Stream',kind:'video',hasAudio:true,duration:10,addedAt:1,
   source:{type:'file',url:'file://stream.mp4',fileName:'stream.mp4',mime:'video/mp4',size:1},
   transcript:[{start:4.5,end:6.5,text:'Wait I have a plan'}]}
 useEditor.getState().loadProject(p)
 await run('begin_video_construction',{goal:'Story'})
 const scan=await run('inspect_video_range',{start_frame:0,end_frame:300,mode:'overview'}) as any
 await run('update_video_construction',{beats:[{id:'scene',start:0,end:300,kind:'scene',summary:'One conversation'}],
  cuts:[{id:'speech',start:160,end:190,beatId:'scene',reason:'Tighten',audioReason:'Unknown',visualReason:'Unknown',evidenceIds:[scan.json.inspection_id]}]})
 const report=await run('inspect_cut_context',{cut_id:'speech'}) as any
 expect(report.recorded).toBe(false)
 expect(report.speech.violations.map((v:any)=>v.edge)).toEqual(['start','end'])
 expect(getProject().construction?.contextInspections).toEqual([])
})
it('rejects join audio inspection before any edit or at an unknown frame',async()=>{
 await run('begin_video_construction',{goal:'Protect reactions'})
 await expect(run('inspect_construction_join_audio',{join_frame:120})).rejects.toThrow(/apply/i)
})
it('supports explicit pause and resume without discarding the story map',async()=>{
 await run('begin_video_construction',{goal:'Story'})
 await run('update_video_construction',{beats:[{id:'scene',start:0,end:300,kind:'scene',summary:'A scene'}]})
 await run('pause_video_construction')
 expect(await run('get_video_construction')).toMatchObject({status:{stage:'paused'}})
 await run('resume_video_construction')
 expect(await run('get_video_construction')).toMatchObject({status:{stage:'discover'},beats:{total:1}})
})


it('returns a bounded, real timeline WAV and persists an audio evidence receipt',async()=>{
 await run('begin_video_construction',{goal:'Check whether the sound is a laugh or an impact'})
 const clip=await run('inspect_construction_audio',{start_frame:30,end_frame:150,purpose:'Check how the joke is delivered'}) as any
 expect(clip.audio).toMatchObject({mimeType:'audio/wav'})
 const {runAgentTool}=await import('../agent-tools')
 const bridged=await runAgentTool('inspect_construction_audio',{start_frame:30,end_frame:150,purpose:'Check the audio bridge'})
 expect(bridged.content.map(c=>c.type)).toEqual(['text','audio'])
 expect(bridged.content[1]).toMatchObject({type:'audio',mimeType:'audio/wav'})
 expect(clip.audio.data).toMatch(/^[A-Za-z0-9+/=]+$/)
 expect(clip.json).toMatchObject({start_frame:30,end_frame:150,purpose:'Check how the joke is delivered'})
 expect(clip.json.audio_seconds).toBeCloseTo(4,2)
 expect(getProject().construction?.audioSamples?.[0]).toMatchObject({id:clip.json.audio_sample_id,start:30,end:150})
 const found=await run('record_construction_audio_observation',{sample_id:clip.json.audio_sample_id,
   event_type:'uncertain',summary:'No known dialogue from transcript; audio inference uncertain',confidence:'low',
   audible_cues:'No identifiable event in mocked source',uncertainty:'Mocked audio is silent'}) as any
 expect(found.saved).toBe(true)
 expect(getProject().construction?.audioObservations?.[0].sampleId).toBe(clip.json.audio_sample_id)
 await expect(run('record_construction_audio_observation',{sample_id:'invented',
   event_type:'laughter',summary:'Someone laughed',confidence:'high',audible_cues:'A laugh was heard',uncertainty:'None'})).rejects.toThrow(/sample/i)
})
it('refuses unbounded or out-of-scope audio uploads',async()=>{
 await run('begin_video_construction',{goal:'Inspect sounds'})
 await expect(run('inspect_construction_audio',{start_frame:0,end_frame:500,purpose:'listen'})).rejects.toThrow(/scope|12/i)
 await expect(run('inspect_construction_audio',{start_frame:0,end_frame:300,purpose:'listen'})).toBeTruthy()
 await expect(run('inspect_construction_audio',{start_frame:0,end_frame:0,purpose:'listen'})).rejects.toThrow()
})

it('indexes audiovisual event candidates from ONLY the current timeline and survives reload',async()=>{
 await run('begin_video_construction',{goal:'Find game events before deleting anything'})
 const first=await run('scan_construction_events',{start_frame:0,end_frame:150}) as any
 expect(first.scan_id).toBeTruthy()
 expect(first.visual_samples).toBeGreaterThan(3)
 expect(first.candidates.some((x:any)=>x.signal==='visual-change')).toBe(true)
 expect(first.candidates.every((x:any)=>x.start>=0&&x.end<=150)).toBe(true)
 expect(await run('get_video_construction')).toMatchObject({
   status:{stage:'discover'},discoveryScans:{total:1},discoveryEvents:{total:first.candidates.length}
 })
 const repeated=await run('scan_construction_events',{start_frame:0,end_frame:150}) as any
 expect(repeated).toMatchObject({scan_id:first.scan_id,reused:true})
 await expect(run('scan_construction_events',{start_frame:120,end_frame:180})).rejects.toThrow(/overlap/i)
 await run('scan_construction_events',{start_frame:150,end_frame:300})
 const after=await run('get_video_construction') as any
 expect(after.discoveryScans.total).toBe(2)
 expect(after.status.stage).toBe('context-bank')
 const reloaded=JSON.parse(JSON.stringify(getProject()))
 useEditor.getState().loadProject(reloaded)
 expect((await run('get_video_construction') as any).discoveryEvents.total).toBeGreaterThan(0)
})
it('refuses to dismiss unexamined discovered events',async()=>{
 await run('begin_video_construction',{goal:'Review all potential events'})
 const result=await run('scan_construction_events',{start_frame:0,end_frame:300}) as any
 const event=result.candidates.find((x:any)=>x.signal==='visual-change')
 expect(event).toBeDefined()
 await expect(run('review_discovered_event',{event_id:event.id,decision:'discard',
   reason:'The inspected action is ordinary repeated waiting, not a protected setup.',
   inspection_ids:[]})).rejects.toThrow(/inspect/i)
 const view=await run('inspect_video_range',{start_frame:event.start,end_frame:event.end,mode:'overview'}) as any
 await expect(run('review_discovered_event',{event_id:event.id,decision:'discard',
   reason:'Overview alone does not justify dropping this event, even when an inspection ID exists.',
   inspection_ids:[view.json.inspection_id]})).rejects.toThrow(/focused/i)
 const focused=await run('inspect_video_range',{start_frame:event.start,end_frame:event.end,mode:'focused',
   priority_frames:event.visualFrames.filter((f:number)=>f>=event.start&&f<event.end)}) as any
 expect(await run('review_discovered_event',{event_id:event.id,decision:'discard',
   reason:'This particular visual switch is a menu that carries no setup or relevant action.',
   inspection_ids:[focused.json.inspection_id]})).toMatchObject({saved:true,decision:'discard'})
 const s=getProject().construction!
 expect(s.discoveryEvents?.find(x=>x.id===event.id)?.inspectionIds).toEqual([focused.json.inspection_id])
 await expect(run('review_discovered_event',{event_id:'fake',decision:'discard',
   reason:'The event was not observed, so no decision is possible.',
   inspection_ids:[view.json.inspection_id]})).rejects.toThrow(/unknown/i)
})

it('prioritizes discovery risks and applies batch decisions atomically',async()=>{
 const p=getProject(),clip=Object.values(p.clips)[0]
 clip.assetId='dialogue'
 p.assets.dialogue={id:'dialogue',name:'Talk',kind:'video',hasAudio:true,duration:10,addedAt:1,
  source:{type:'file',url:'file://talk.mp4',fileName:'talk.mp4',mime:'video/mp4',size:1},
  transcript:[{start:6,end:7,text:'I cannot believe that just happened'}]}
 useEditor.getState().loadProject(p)
 await run('begin_video_construction',{goal:'Protect late dialogue and gameplay changes'})
 const scan=await run('scan_construction_events',{start_frame:0,end_frame:300}) as any
 const visual=scan.candidates.find((e:any)=>e.signal==='visual-change')
 const speech=scan.candidates.find((e:any)=>e.signal==='speech')
 expect(visual).toBeDefined();expect(speech).toBeDefined()
 const queue=await run('get_discovery_queue',{limit:10}) as any
 expect(queue.total).toBeGreaterThanOrEqual(2)
 expect(queue.items[0].signal).toBe('visual-change')
 const a=await run('inspect_video_range',{start_frame:visual.start,end_frame:visual.end,mode:'overview'}) as any
 const b=await run('inspect_video_range',{start_frame:speech.start,end_frame:speech.end,mode:'focused'}) as any
 const decisions=[
 {event_id:visual.id,decision:'keep',reason:'Observed the game scene changes in the rendered visual sequence.',inspection_ids:[a.json.inspection_id]},
 {event_id:speech.id,decision:'discard',reason:'Inspected the particular line; it is redundant for this intended edit.',inspection_ids:[b.json.inspection_id]},
 ]
 await expect(run('review_discovered_events',{decisions:[decisions[0],{...decisions[1],inspection_ids:[]}]})).rejects.toThrow(/inspection/)
 expect(getProject().construction?.discoveryEvents?.find(e=>e.id===visual.id)?.decision).toBeUndefined()
 expect(await run('review_discovered_events',{decisions})).toMatchObject({saved:true,reviewed:[visual.id,speech.id]})
 const pending=await run('get_discovery_queue') as any
 expect(pending.items.some((e:any)=>e.id===visual.id||e.id===speech.id)).toBe(false)
})

it('refuses sparse overview as discard evidence and accepts exact-priority focused frames',async()=>{
 await run('begin_video_construction',{goal:'Inspect difficult visual details'})
 const scan=await run('scan_construction_events',{start_frame:0,end_frame:300}) as any
 const candidate=scan.candidates.find((e:any)=>e.signal==='visual-change')
 expect(candidate).toBeTruthy()
 const overview=await run('inspect_video_range',{start_frame:candidate.start,end_frame:candidate.end,mode:'overview'}) as any
 await expect(run('review_discovered_event',{event_id:candidate.id,decision:'discard',
   reason:'The screenshot overview does not prove the visual action was irrelevant.',
   inspection_ids:[overview.json.inspection_id]})).rejects.toThrow(/focused/i)
 const detail=await run('inspect_video_range',{start_frame:candidate.start,end_frame:candidate.end,mode:'focused',
   priority_frames:candidate.visualFrames.filter((f:number)=>f>=candidate.start&&f<candidate.end)}) as any
 expect(detail.json.frames).toEqual([...detail.json.frames].sort((a:number,b:number)=>a-b))
 expect(detail.json.frames.length).toBeGreaterThan(12)
 expect(detail.json.frames).toContain(candidate.visualFrames[0])
 expect(await run('review_discovered_event',{event_id:candidate.id,decision:'discard',
   reason:'Dense visual evidence directly shows a fixture transition with no necessary story content.',
   inspection_ids:[detail.json.inspection_id]})).toMatchObject({saved:true,decision:'discard'})
})

it('refuses to certify a new discovery scan when audible timeline speech has not been transcribed',async()=>{
 const p=getProject(),clip=Object.values(p.clips)[0]
 clip.assetId='speech-recording'
 p.assets['speech-recording']={id:'speech-recording',name:'Recorded gameplay',kind:'video',
  hasAudio:true,duration:10,addedAt:1,source:{type:'file',url:'file://speech.mp4',
    fileName:'speech.mp4',mime:'video/mp4',size:1}}
 useEditor.getState().loadProject(p)
 await run('begin_video_construction',{goal:'Understand the recording before editing'})
 expect(await run('get_video_construction')).toMatchObject({missing_timeline_transcripts:['speech-recording']})
 await expect(run('scan_construction_events',{start_frame:0,end_frame:300})).rejects.toThrow(/transcrib/i)
 expect((getProject().construction?.discoveryScans??[])).toHaveLength(0)
 const next=structuredClone(getProject())
 next.assets['speech-recording'].transcript=[{start:2,end:3,text:'There is a ghost nearby'}]
 useEditor.getState().loadProject(next)
 const scan=await run('scan_construction_events',{start_frame:0,end_frame:300}) as any
 expect(scan.candidates.some((e:any)=>e.signal==='speech')).toBe(true)
 expect((await run('get_video_construction') as any).missing_timeline_transcripts).toEqual([])
})
it('allows scanning gameplay-only audio after a completed no-speech transcription',async()=>{
 const p=getProject(),clip=Object.values(p.clips)[0]
 clip.assetId='gameplay-audio'
 p.assets['gameplay-audio']={id:'gameplay-audio',name:'Gameplay without commentary',kind:'video',
  hasAudio:true,duration:10,addedAt:1,source:{type:'file',url:'file://gameplay.mp4',
    fileName:'gameplay.mp4',mime:'video/mp4',size:1}}
 useEditor.getState().loadProject(p)
 await run('begin_video_construction',{goal:'Keep interesting silent gameplay'})
 expect((await run('get_video_construction') as any).missing_timeline_transcripts).toContain('gameplay-audio')
 const next=structuredClone(getProject())
 next.assets['gameplay-audio'].transcript=[] // Transcriber ran; zero words is not a missing result.
 useEditor.getState().loadProject(next)
 expect((await run('get_video_construction') as any).missing_timeline_transcripts).toEqual([])
 expect(await run('scan_construction_events',{start_frame:0,end_frame:300})).toMatchObject({start_frame:0,end_frame:300})
})
it('persists evidence revisions when rewriting a story beat without changing counts',async()=>{
 await run('begin_video_construction',{goal:'Make a coherent game highlight'})
 const first=(await run('get_video_construction') as any).revision
 await run('update_video_construction',{beats:[{id:'opening',start:0,end:300,kind:'scene',summary:'A generic opening'}]})
 const second=(await run('get_video_construction') as any).revision
 await run('update_video_construction',{beats:[{id:'opening',start:0,end:300,kind:'scene',summary:'The rule explanation and first reaction'}]})
 const last=(await run('get_video_construction') as any)
 expect(second).toBe(first+1)
 expect(last.revision).toBe(second+1)
 expect(last.beats.total).toBe(1)
 expect(last.beats.items[0].summary).toMatch(/rule explanation/)
})

it('requires the full context pass first, then reuses identical global-bank lookups without fake progress',async()=>{
 await run('begin_video_construction',{goal:'Link the full recording setup to the eventual callback'})
 const state=(await run('get_video_construction') as any)
 expect(state.sectionPlan.pending_context).toBeGreaterThan(0)
 const edit=state.next_edit_section.id
 await expect(run('get_construction_edit_context',{section_id:edit,question:'Where does the callback start?'}))
   .rejects.toThrow(/whole-timeline context banking/i)
 const overview=await run('inspect_video_range',{start_frame:0,end_frame:300,mode:'overview'}) as any
 const id=state.next_context_section.id
 await expect(run('record_construction_context_section',{
   section_id:id,summary:'Observed the opening mock footage and later change, with uncertainty.',
   key_moments:['A visual change is possible'],uncertainties:['Unknown meaning'],
   inspection_ids:[overview.json.inspection_id],
 })).rejects.toThrow(/discovery/i)
 await run('scan_construction_events',{start_frame:0,end_frame:300})
 const section=(await run('get_video_construction') as any).next_context_section
 await run('record_construction_context_section',{
   section_id:section.id,
   summary:'Inspected the authorised visual transition in the mock recording, with uncertain meaning.',
   key_moments:['Observed a changing sampled scene'],
   uncertainties:['No semantic game event was inferred from the stills'],
   inspection_ids:[overview.json.inspection_id],
 })
 const first=await run('get_construction_edit_context',{section_id:edit,question:'Where does the callback start?'}) as any
 expect(first.context.some((x:any)=>x.id===section.id)).toBe(true)
 const revision=(await run('get_video_construction') as any).revision
 const again=await run('get_construction_edit_context',{section_id:edit,question:'Where does the callback start?'}) as any
 expect(again.reused).toBe(true)
 expect((await run('get_video_construction') as any).revision).toBe(revision)
 await expect(run('record_construction_edit_section',{section_id:edit,
   summary:'This local section is unplanned because a narrative beat was not established.',
   inspection_ids:[overview.json.inspection_id]})).rejects.toThrow(/story beat/i)
})

it('auditions the actual source PCM between two selected moments BEFORE publishing',async()=>{
 await run('begin_video_construction',{goal:'Make a short video with clear original setup and ending'})
 await run('scan_construction_events',{start_frame:0,end_frame:300})
 const overview=await run('inspect_video_range',{start_frame:0,end_frame:300,mode:'overview'}) as any
 const begin=await run('inspect_video_range',{start_frame:0,end_frame:3,mode:'boundary'}) as any
 const middle=await run('inspect_video_range',{start_frame:148,end_frame:152,mode:'boundary'}) as any
 const finish=await run('inspect_video_range',{start_frame:297,end_frame:300,mode:'boundary'}) as any
 await run('update_video_construction',{beats:[
  {id:'beginning',start:0,end:150,kind:'scene',summary:'Challenge explanation and first section'},
  {id:'ending',start:150,end:300,kind:'scene',summary:'Second section and final result'}]})
 await completeTwoPassSections(overview.json.inspection_id)
 const inspection_ids=[overview.json.inspection_id,begin.json.inspection_id,
  middle.json.inspection_id,finish.json.inspection_id]
 await run('record_keep_first_selections',{selections:[
  {id:'source-a',start_frame:0,end_frame:150,output_order:0,role:'setup',beat_id:'beginning',
    reason:'Retain the original challenge explanation.',inspection_ids},
  {id:'source-b',start_frame:150,end_frame:300,output_order:1,role:'ending',beat_id:'ending',
    reason:'Retain the original result and ending.',inspection_ids},
 ]})
 await expect(run('inspect_keep_first_join_audio',{join_index:1})).rejects.toThrow(/join/i)
 const before=await run('preview_keep_first_assembly') as any
 expect(before.audio_preflight).toMatchObject([{join_index:0,inspected:false}])
 audioMock.click=true
 const audition=await run('inspect_keep_first_join_audio',{join_index:0}) as any
 expect(audition.audio).toMatchObject({mimeType:'audio/wav'})
 expect(audition.json).toMatchObject({join_index:0,output_join_frame:150,saved:true})
 expect(audition.json.report.flags).toContain('possible-click')
 expect(getProject().construction?.spliceAudioChecks).toHaveLength(1)
 const preview=await run('preview_keep_first_assembly') as any
 expect(preview.audio_preflight).toMatchObject([{join_index:0,inspected:true}])
 expect(preview.audio_preflight[0].report.flags).toContain('possible-click')
 expect(getProject().sequence?.id).not.toEqual('new-video')
})

it('publishes an independently editable output sequence without changing the original footage',async()=>{
 await run('begin_video_construction',{goal:'Turn all permitted original gameplay into an editable source-backed narrative cut'})
 const clip=Object.values(getProject().clips)[0]
 const originalId=getProject().sequence?.id??'seq_main'
 const originalClips=structuredClone(getProject().clips)
 const first=(await run('get_video_construction') as any)
 expect(first.source_manifest.source_clips).toBe(1)
 await run('scan_construction_events',{start_frame:0,end_frame:300})
 const overview=await run('inspect_video_range',{start_frame:0,end_frame:300,mode:'overview'}) as any
 const startEdge=await run('inspect_video_range',{start_frame:0,end_frame:3,mode:'boundary'}) as any
 await run('update_video_construction',{beats:[{id:'complete',start:0,end:300,kind:'scene',
   summary:'Maintain the entire original video, including its beginning and final payoff.'}]})
 await completeTwoPassSections(overview.json.inspection_id)
 expect((await run('get_video_construction') as any).status.stage).toBe('assemble')
 await expect(run('publish_keep_first_assembly')).rejects.toThrow(/Select/)
 await run('record_keep_first_selections',{selections:[{
   id:'complete-video',start_frame:0,end_frame:300,output_order:0,
   role:'complete',beat_id:'complete',
   reason:'Keep the complete game and commentary intact in the first non-destructive version.',
   inspection_ids:[overview.json.inspection_id,startEdge.json.inspection_id],
 }]})
 const preview=await run('preview_keep_first_assembly',{name:'Lumen first cut'}) as any
 expect(preview).toMatchObject({valid:true,original_sequence_id:originalId,output_frames:300})
 const prior=useEditor.getState().past.length
 const published=await run('publish_keep_first_assembly',{name:'Lumen first cut'}) as any
 expect(published).toMatchObject({published:true,original_sequence_id:originalId,output_frames:300,
   status:{stage:'review',complete:false}})
 expect(useEditor.getState().past).toHaveLength(prior+1)
 const project=getProject()
 expect(project.sequence?.id).toBe(published.sequence_id)
 expect(project.sequences?.[originalId].clips).toEqual(originalClips)
 const mapping=project.construction!.assembly!
 expect(mapping.sourceSequenceId).toBe(originalId)
 expect(mapping.selections[0]).toMatchObject({sourceStart:0,sourceEnd:300,outputStart:0,outputEnd:300})
 expect(mapping.clips[0].originalClipId).toBe(clip.id)
 expect(mapping.clips[0].outputClipId).not.toBe(clip.id)
 expect(Object.values(project.clips)[0].duration).toBe(300)
 expect(await run('audit_assembled_source_map')).toMatchObject({available:true,ok:true,checkedClips:1,outputFrames:300})
 expect(await run('audit_output_narrative')).toMatchObject({available:true,ok:true,checkedEssentialMoments:0})
 const corrupted=structuredClone(project)
 corrupted.clips[mapping.clips[0].outputClipId].inPoint+=7
 const {auditPublishedAssembly}=await import('@/editor/construction-assembler')
 expect(auditPublishedAssembly(corrupted,corrupted.construction!).issues).toEqual(
   expect.arrayContaining([expect.stringMatching(/in-point|timing/i)]))
 await expect(run('publish_keep_first_assembly')).rejects.toThrow(/already|published/i)
 useEditor.getState().undo()
 expect(getProject().sequence?.id??'seq_main').toBe(originalId)
 expect(getProject().clips).toEqual(originalClips)
 expect(getProject().construction?.applied).toBeUndefined()
})

it('repairs a failed output by reopening the unchanged original and preserving both versions',async()=>{
 await run('begin_video_construction',{goal:'Construct source-backed gaming video with an ending'})
 await run('scan_construction_events',{start_frame:0,end_frame:300})
 const overview=await run('inspect_video_range',{start_frame:0,end_frame:300,mode:'overview'}) as any
 const edge=await run('inspect_video_range',{start_frame:0,end_frame:3,mode:'boundary'}) as any
 await run('update_video_construction',{beats:[{id:'scene',start:0,end:300,kind:'scene',summary:'Whole timeline for a repairable first pass'}]})
 await completeTwoPassSections(overview.json.inspection_id)
 await run('record_keep_first_selections',{selections:[{id:'whole',start_frame:0,end_frame:300,output_order:0,
   role:'complete',beat_id:'scene',reason:'Preserve complete first version for a source-backed repair trial.',
   inspection_ids:[overview.json.inspection_id,edge.json.inspection_id]}]})
 const originalId=getProject().sequence?.id??'seq_main'
 const originalClips=structuredClone(getProject().clips)
 const first=await run('publish_keep_first_assembly',{name:'First version'}) as any
 expect(first.status.stage).toBe('review')
 const firstId=first.sequence_id
 await expect(run('reopen_construction_source_for_repair')).rejects.toThrow(/review/i)
 await run('inspect_video_range',{start_frame:0,end_frame:300,mode:'overview'})
 const failed=await run('review_video_construction',{story:'This has no creative hook or pacing',
   pacing:'It is the complete recording without meaningful tightening',
   issues:['The opening hook and ending need a more compelling sequence']}) as any
 expect(failed.status.complete).toBe(false)
 const redo=await run('reopen_construction_source_for_repair') as any
 expect(redo).toMatchObject({reopened:true,original_sequence_id:originalId,
   previous_output_sequence_id:firstId,repair_depth:1,status:{stage:'assemble'}})
 expect(getProject().clips).toEqual(originalClips)
 expect(getProject().sequences?.[firstId]).toBeTruthy()
 expect(getProject().construction?.sourceSelections?.map(x=>x.id)).toEqual(['whole'])
 expect(getProject().construction?.inspections.length).toBeGreaterThan(0)
 expect(getProject().construction?.repairOf?.issues).toContain('The opening hook and ending need a more compelling sequence')
 const second=await run('publish_keep_first_assembly',{name:'Corrected version'}) as any
 expect(second.sequence_id).not.toBe(firstId)
 expect(second.original_sequence_id).toBe(originalId)
 expect(getProject().sequences?.[firstId]).toBeTruthy()
 expect(getProject().sequences?.[originalId].clips).toEqual(originalClips)
})

it('banks verified narrative moments with causal links without inflating repeat progress',async()=>{
 await run('begin_video_construction',{goal:'Keep the actual challenge rules and payoff in the narrative'})
 const inspection=await run('inspect_video_range',{start_frame:0,end_frame:300,mode:'overview'}) as any
 const moments=[
  {id:'rule',start_frame:10,end_frame:20,kind:'rule',importance:'essential',confidence:'observed',
   description:'The actual inspected opening declares a specific challenge rule',
   inspection_ids:[inspection.json.inspection_id],links:[]},
  {id:'payoff',start_frame:200,end_frame:210,kind:'joke-payoff',importance:'essential',confidence:'observed',
   description:'The inspected scene contains the actual result of the earlier setup',
   inspection_ids:[inspection.json.inspection_id],links:[{moment_id:'rule',relation:'requires'}]},
 ]
 const first=await run('record_construction_narrative_moments',{moments}) as any
 expect(first).toMatchObject({saved:true,total:2})
 const oldRevision=(await run('get_video_construction') as any).revision
 expect(await run('record_construction_narrative_moments',{moments})).toMatchObject({saved:false,reused:true,total:2})
 const snapshot=await run('get_video_construction') as any
 expect(snapshot.revision).toBe(oldRevision)
 expect(snapshot.narrativeMoments.total).toBe(2)
 expect(snapshot.narrativeMoments.items[1].links).toEqual([{momentId:'rule',relation:'requires'}])
 await expect(run('record_construction_narrative_moments',{moments:[{
   ...moments[0],id:'uncertain',confidence:'uncertain',kind:'round-start',
 }]})).rejects.toThrow(/uncertain/i)
})

it('retains semantic interpretations only after real focused source inspection',async()=>{
 await run('begin_video_construction',{goal:'Identify scene changes without inventing gameplay'})
 const scan=await run('scan_construction_events',{start_frame:0,end_frame:300}) as any
 const candidate=scan.candidates.find((e:any)=>e.signal==='visual-change')
 expect(candidate).toBeDefined()
 const queue=await run('get_event_investigation_queue',{limit:15}) as any
 expect(queue.items.some((e:any)=>e.id===candidate.id)).toBe(true)
 const overview=await run('inspect_video_range',{start_frame:candidate.start,end_frame:candidate.end,mode:'overview'}) as any
 const fact={event_id:candidate.id,kind:'scene-change',confidence:'observed',
   summary:'The supplied test images change from dark to bright at the sampled scene edge.',
   inspection_ids:[overview.json.inspection_id],uncertainty:'Image difference alone cannot establish specific game events.'}
 await expect(run('record_construction_event_findings',{findings:[fact]}))
   .rejects.toThrow(/focused|frame-by-frame/i)
 const observed=await run('inspect_video_range',{start_frame:candidate.start,end_frame:candidate.end,
   mode:'focused',priority_frames:candidate.visualFrames.filter((f:number)=>f>=candidate.start&&f<candidate.end)}) as any
 const grounded={...fact,inspection_ids:[observed.json.inspection_id]}
 expect(await run('record_construction_event_findings',{findings:[grounded]}))
   .toMatchObject({saved:true,interpreted:1})
 expect(await run('record_construction_event_findings',{findings:[grounded]}))
   .toMatchObject({saved:false,reused:true})
 const report=await run('get_video_construction') as any
 expect(report.eventFindings.total).toBe(1)
 expect(report.eventFindings.items[0].eventId).toBe(candidate.id)
 expect(report.pendingEventInvestigations.some((e:any)=>e.id===candidate.id)).toBe(false)
 await expect(run('record_construction_event_findings',{findings:[{...grounded,
   kind:'laughter',summary:'Loud audio must not automatically count as a person laughing.'}]}))
   .rejects.toThrow(/real-audio listening/i)
})

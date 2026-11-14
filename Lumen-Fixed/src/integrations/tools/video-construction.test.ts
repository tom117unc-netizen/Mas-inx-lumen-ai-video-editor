import { beforeEach, expect, it, vi } from 'vitest'
import type { Project } from '@/editor/types'
vi.mock('@/engine/stills',()=>({timelineStills:async(_p:Project,frames:number[],width:number)=>frames.map(()=>({width,height:width*9/16})),canvasBase64:()=> 'image',contactSheet:()=>({}),mediaStills:()=>[]}))
vi.mock('@/project/session',()=>({useSession:{getState:()=>({path:'/test.lumen'})},saveProject:async()=>true,isDirty:()=>false}))
vi.mock('@/engine/audio-engine',async original=>({...await original<typeof import('@/engine/audio-engine')>(),prepareAudio:async()=>{},renderMix:async()=>({sampleRate:48000,length:48000,duration:1,numberOfChannels:1,getChannelData:()=>new Float32Array(48000)})}))
const { VIDEO_CONSTRUCTION_TOOLS }=await import('./video-construction')
const { useEditor,getProject,dispatch }=await import('@/editor/store')
const { createEmptyProject }=await import('@/editor/new-project')
const { createClip }=await import('@/editor/defaults')
const run=(name:string,args:Record<string,unknown>={})=>VIDEO_CONSTRUCTION_TOOLS.find(t=>t.name===name)!.run(args)
beforeEach(()=>{
 const p=createEmptyProject('Video');const c=createClip({kind:'video',trackId:p.tracks[0].id,start:0,duration:300});p.clips[c.id]=c;useEditor.getState().loadProject(p)
})
it('registers a resumable workflow and marks project dirty without changing clips',async()=>{
 const before=structuredClone(getProject().clips),v=useEditor.getState().version
 await run('begin_video_construction',{goal:'Funny story'})
 expect(getProject().clips).toEqual(before);expect(useEditor.getState().version).toBeGreaterThan(v)
 const reloaded=JSON.parse(JSON.stringify(getProject()));useEditor.getState().loadProject(reloaded)
 expect(await run('get_video_construction')).toMatchObject({status:{stage:'investigate'}})
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
 const scan=await run('inspect_video_range',{start_frame:0,end_frame:300,mode:'overview'}) as any
 const first=await run('inspect_video_range',{start_frame:99,end_frame:102,mode:'boundary'}) as any
 const last=await run('inspect_video_range',{start_frame:199,end_frame:202,mode:'boundary'}) as any
 await run('update_video_construction',{coverage:[{id:'all',start:0,end:300,visual:'Checked footage',audio:'Checked sound context',evidenceIds:[scan.json.inspection_id]}],beats:[{id:'scene',start:0,end:300,kind:'scene',summary:'Approach and reaction',dependsOn:[],protectedRanges:[]}],cuts:[{id:'cut',start:100,end:200,beatId:'scene',reason:'Repeated waiting',visualReason:'No new action',audioReason:'No line lost',evidenceIds:[scan.json.inspection_id,first.json.inspection_id,last.json.inspection_id]}]})
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
 // Use the live flow to generate receipts, not model-supplied evidence.
 const ids=[]
 for(const [start,end,mode] of [[0,300,'overview'],[99,102,'boundary'],[199,202,'boundary']] as const) {
  const r=await run('inspect_video_range',{start_frame:start,end_frame:end,mode}) as any;ids.push(r.json.inspection_id)
 }
 await run('update_video_construction',{coverage:[{id:'all',start:0,end:300,visual:'Checked',audio:'Checked',evidenceIds:[ids[0]]}],beats:[{id:'scene',start:0,end:300,kind:'scene',summary:'Scene'}],cuts:[{id:'c',start:100,end:200,beatId:'scene',reason:'Repeated action',audioReason:'No line lost',visualReason:'No action lost',evidenceIds:ids}]})
 await run('inspect_cut_context',{cut_id:'c'})
 await run('apply_video_construction')
 await expect(run('review_video_construction',{story:'Clear',pacing:'Good',issues:[]})).rejects.toThrow(/whole output/i)
 await run('inspect_video_range',{start_frame:0,end_frame:200,mode:'overview'})
 await expect(run('review_video_construction',{story:'Clear',pacing:'Good',issues:[]})).rejects.toThrow(/join/i)
 await run('inspect_video_range',{start_frame:99,end_frame:102,mode:'boundary'})
 expect(await run('review_video_construction',{story:'Setup and payoff remain',pacing:'Waiting shortened without losing reaction',issues:[]})).toMatchObject({status:{complete:true}})
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
it('supports explicit pause and resume without discarding the story map',async()=>{
 await run('begin_video_construction',{goal:'Story'})
 await run('update_video_construction',{beats:[{id:'scene',start:0,end:300,kind:'scene',summary:'A scene'}]})
 await run('pause_video_construction')
 expect(await run('get_video_construction')).toMatchObject({status:{stage:'paused'}})
 await run('resume_video_construction')
 expect(await run('get_video_construction')).toMatchObject({status:{stage:'investigate'},beats:{total:1}})
})

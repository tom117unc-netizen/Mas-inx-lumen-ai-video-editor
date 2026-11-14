import { expect, it } from 'vitest'
import { constructionContinuation } from './construction-continuation'
it('continues incomplete work only while it makes bounded progress',()=>{
 const snapshot={status:{stage:'investigate',complete:false},inspections:{total:12},coverage:{total:4},beats:{total:2},cuts:{total:0}}
 const first=constructionContinuation(snapshot,0)
 expect(first.continue).toBe(true)
 expect(constructionContinuation(snapshot,1,first.progress).continue).toBe(false)
 expect(constructionContinuation({...snapshot,inspections:{total:20}},1,first.progress).continue).toBe(true)
 expect(constructionContinuation(snapshot,12).continue).toBe(false)
})
it('never continues completed, stale, absent or malformed construction',()=>{
 for(const s of [null,{}, {status:{stage:'complete',complete:true}}, {status:{stage:'stale',complete:false}}]) expect(constructionContinuation(s,0).continue).toBe(false)
})

it('starts automatic continuation only for explicit begin/resume tools',async()=>{
 const { isConstructionExecutionTool }=await import('./construction-continuation')
 expect(isConstructionExecutionTool('begin_video_construction')).toBe(true)
 expect(isConstructionExecutionTool('resume_video_construction')).toBe(true)
 for(const tool of ['get_video_construction','inspect_video_range','update_video_construction','review_video_construction']) expect(isConstructionExecutionTool(tool)).toBe(false)
})

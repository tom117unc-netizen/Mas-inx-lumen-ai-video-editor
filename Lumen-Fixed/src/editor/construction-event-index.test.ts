import {describe,expect,it} from 'vitest'
import {audioIndexBins,discoverTimelineEvents,type EventScanInput} from './construction-event-index'

const base=():EventScanInput=>({
 start:0,end:900,fps:30,visuals:[],audio:[],speech:[],boundaries:[]
})
describe('timeline event discovery: evidence, not semantic claims',()=>{
 it('finds sharp but not ordinary visual movement, preserving exact sample provenance',()=>{
  const x=base();x.visuals=[0,1,2,3,4,5,6].map((i)=>({frame:i*30,score:i===3?58:3+i%2}))
  const hits=discoverTimelineEvents(x).filter(v=>v.signal==='visual-change')
  expect(hits).toHaveLength(1)
  expect(hits[0]).toMatchObject({visualFrames:[90,60]})
  expect(hits[0].description).toMatch(/sampled/)
 })
 it('finds audio level transitions but never calls them a laugh or a game event',()=>{
  const x=base();x.audio=[-70,-70,-70,-70,-18,-18,-18,-62,-62].map((db,i)=>({db,frame:30*i}))
  const hits=discoverTimelineEvents(x).filter(v=>v.signal.startsWith('audio'))
  expect(hits.some(x=>x.signal==='audio-onset')).toBe(true)
  expect(hits.some(x=>x.signal==='audio-drop')).toBe(true)
  expect(hits.every(x=>/level|audible/.test(x.description))).toBe(true)
 })
 it('keeps timed transcripts and existing boundaries separately sourced',()=>{
  const x=base()
  x.speech=[{start:2,end:3,text:'Wait, I have a plan',clipId:'recording'},{start:3.1,end:4,text:'Actually never mind',clipId:'recording'}]
  x.boundaries=[450,450]
  const hits=discoverTimelineEvents(x)
  expect(hits.filter(h=>h.signal==='speech')).toHaveLength(1)
  expect(hits.find(h=>h.signal==='speech')?.transcriptClipIds).toEqual(['recording'])
  expect(hits.filter(h=>h.signal==='clip-boundary')).toHaveLength(1)
 })
 it('does not label unsampled silence safe to delete',()=>{
  const x=base()
  expect(discoverTimelineEvents(x)).toEqual([])
 })
 it('clips every candidate inside the declared scan range',()=>{
  const x:EventScanInput={...base(),start:300,end:450}
  x.speech=[{start:0,end:20,text:'crossing',clipId:'x'}]
  x.audio=[{frame:305,db:-80},{frame:310,db:-80},{frame:315,db:-80},{frame:320,db:0},{frame:325,db:0}]
  const hits=discoverTimelineEvents(x)
  expect(hits.length).toBeGreaterThan(0)
  expect(hits.every(h=>h.start>=300&&h.end<=450)).toBe(true)
 })
 it('converts RMS frames to peak-level candidate bins',()=>{
  const bins=audioIndexBins(Float32Array.from([-70,-45,-50,-10,-20,-80,-120,-120,-120,-120]),300,30,.02,.1)
  expect(bins).toHaveLength(2)
  expect(bins[0].db).toBe(-10)
  expect(bins[1].db).toBe(-80)
 })
 it('rejects malformed scan bounds',()=>{
  expect(()=>discoverTimelineEvents({...base(),end:0})).toThrow(/range/)
 })
})

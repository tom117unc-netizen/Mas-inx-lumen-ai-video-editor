import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './new-project'
import { createClip } from './defaults'
import { beginConstruction, constructionStatus, constructionStorySignature, updateConstruction, validateConstructionCuts, nextEventProbe } from './video-construction'

function fixture() {
  const p = createEmptyProject('Stream')
  const c = createClip({kind:'video',trackId:p.tracks[0].id,start:0,duration:600})
  p.clips[c.id] = c
  return p
}
const beat = (id:string, start:number, end:number, dependsOn:string[] = []) => ({id,start,end,kind:'scene' as const,summary:id,dependsOn,protectedRanges:[]})
const coverage = {id:'scan',start:0,end:600,visual:'Observed action',audio:'Transcript and audio metrics checked',evidenceIds:['receipt']}
const receipt = {id:'receipt',start:0,end:600,frames:[0,100,200,300,400,500,599],audio:true,transcript:true}
const cut = {id:'cut',start:100,end:200,reason:'Repetitive walking',beatId:'scene',evidenceIds:['receipt'],audioReason:'No interrupted speech',visualReason:'No necessary action omitted'}
function ready() {
  const p=fixture(); const s=beginConstruction(p,'Funny coherent stream edit')
  s.inspections.push(receipt)
  const next=updateConstruction(s,{coverage:[coverage],beats:[beat('scene',0,600)],cuts:[cut]})
  next.contextInspections=[{cutId:'cut',storySignature:constructionStorySignature(next)}]
  return {p,s:next}
}
describe('construction gates',()=>{
  it('starts with unknown coverage, survives JSON and directs investigation',()=>{
    const p=fixture(), s=JSON.parse(JSON.stringify(beginConstruction(p,'Story')))
    expect(constructionStatus(p,s).stage).toBe('investigate')
    expect(constructionStatus(p,s).uncovered).toEqual([{start:0,end:600}])
  })
  it('requires actual inspection receipts before accepting coverage',()=>{
    const p=fixture(), s=beginConstruction(p,'Story')
    expect(()=>updateConstruction(s,{coverage:[coverage]})).toThrow(/inspection/i)
  })
  it('finds coverage holes and requires both modalities',()=>{
    const {p,s}=ready(); s.coverage=[{...coverage,end:250},{...coverage,id:'tail',start:300}]
    expect(constructionStatus(p,s).uncovered).toEqual([{start:250,end:300}])
    expect(()=>validateConstructionCuts(p,s)).toThrow(/coverage/i)
  })
  it('rejects a silent cut through protected visual anticipation',()=>{
    const {p,s}=ready(); s.beats[0].protectedRanges=[{start:150,end:170,reason:'Silent approach sets up reaction'}]
    expect(()=>validateConstructionCuts(p,s)).toThrow(/protected/i)
  })
  it('protects setup dependencies from even partial removal',()=>{
    const {p,s}=ready(); s.beats=[beat('setup',100,220),beat('scene',220,600,['setup'])]; s.cuts[0].beatId='setup'
    expect(()=>validateConstructionCuts(p,s)).toThrow(/depend|setup/i)
  })
  it('rejects cyclic story dependencies',()=>{
    const {s}=ready()
    expect(()=>updateConstruction(s,{beats:[beat('a',0,300,['b']),beat('b',300,600,['a'])]})).toThrow(/cycl/i)
  })
  it('rejects stale timelines but ignores construction metadata itself',()=>{
    const {p,s}=ready(); s.inspections.push({id:'edges',start:99,end:202,frames:[99,100,101,199,200,201],audio:true,transcript:true}); s.cuts[0].evidenceIds.push('edges'); s.contextInspections=[{cutId:'cut',storySignature:constructionStorySignature(s)}]; p.construction=s
    expect(validateConstructionCuts(p,s)).toHaveLength(1)
    Object.values(p.clips)[0].duration--
    expect(()=>validateConstructionCuts(p,s)).toThrow(/changed|stale/i)
  })
  it('rejects fractional, overlapping and out-of-scope cuts',()=>{
    const {s}=ready()
    for(const cuts of [[{...cut,start:100.5}],[cut,{...cut,id:'other',start:150,end:250}],[{...cut,end:601}]]) {
      expect(()=>updateConstruction(s,{cuts})).toThrow()
    }
  })
  it('requires adjacent-frame inspections at both cut edges',()=>{
    const {p,s}=ready()
    expect(()=>validateConstructionCuts(p,s)).toThrow(/boundary|adjacent/i)
    s.inspections.push({id:'edges',start:99,end:202,frames:[99,100,101,199,200,201],audio:true,transcript:true})
    s.cuts[0].evidenceIds.push('edges')
    s.contextInspections=[{cutId:'cut',storySignature:constructionStorySignature(s)}]
    expect(validateConstructionCuts(p,s)[0]).toMatchObject({start:100,end:200})
  })
  it('requires a context read tied to the current cut and story map',()=>{
    const {p,s}=ready()
    s.inspections.push({id:'edges',start:99,end:202,frames:[99,100,101,199,200,201],audio:true,transcript:true})
    s.cuts[0].evidenceIds.push('edges')
    expect(()=>validateConstructionCuts(p,s)).toThrow(/context/i)
    s.contextInspections=[{cutId:'cut',storySignature:constructionStorySignature(s)}]
    expect(validateConstructionCuts(p,s)).toHaveLength(1)
    s.beats[0].summary='Different meaning after inspection'
    expect(()=>validateConstructionCuts(p,s)).toThrow(/context/i)
  })
  it('does not call a merely applied edit complete',()=>{
    const {p,s}=ready(); s.applied={fingerprint:s.fingerprint,joins:[100]}
    expect(constructionStatus(p,s).stage).toBe('review')
  })
})
describe('event narrowing',()=>{
  it('bisects only a bracketed single-change interval and stops at adjacent frames',()=>{
    expect(nextEventProbe(100,200,true,false,true)).toEqual({frame:150,done:false})
    expect(nextEventProbe(100,101,true,false,true)).toEqual({frame:101,done:true})
    expect(()=>nextEventProbe(100,200,true,true,true)).toThrow()
    expect(()=>nextEventProbe(100,200,true,false,false)).toThrow(/scan|repeat/i)
  })
})
it('keeps analysis valid when transcript caches arrive but invalidates changed source identity',()=>{
 const p=fixture();p.assets.a={id:'a',name:'Stream',kind:'video',duration:20,addedAt:1,source:{type:'file',url:'file://stream',path:'/stream.mp4',fileName:'stream.mp4',mime:'video/mp4',size:100}}
 const s=beginConstruction(p,'Story')
 p.assets.a.transcript=[{start:0,end:1,text:'hello'}]
 expect(constructionStatus(p,s).stage).not.toBe('stale')
 if(p.assets.a.source.type==='file') p.assets.a.source.size=101
 expect(constructionStatus(p,s).stage).toBe('stale')
})
it('ignores image-sequence transport paths added during project save and reload',()=>{
 const p=fixture();p.assets.seq={id:'seq',name:'Frames',kind:'video',duration:10,addedAt:1,source:{type:'sequence',base:'lumen-media://old/',dir:'/frames',pattern:'frame_%04d.png',fps:30,frameCount:300}}
 const s=beginConstruction(p,'Story')
 if(p.assets.seq.source.type==='sequence') {p.assets.seq.source.relDir='../frames';p.assets.seq.source.base='lumen-media://new/';p.assets.seq.source.poster='lumen-media://new/frame_0001.png'}
 expect(constructionStatus(p,s).stage).not.toBe('stale')
 if(p.assets.seq.source.type==='sequence') p.assets.seq.source.frameCount=301
 expect(constructionStatus(p,s).stage).toBe('stale')
})

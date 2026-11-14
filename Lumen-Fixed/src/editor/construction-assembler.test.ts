import {describe,expect,it} from 'vitest'
import {createClip} from './defaults'
import {createEmptyProject} from './new-project'
import {cloneClip} from './ops'
import {captureConstructionManifest,composeKeepFirstSequence,validateKeepFirstSelections,validateOutputSourceMap} from './construction-assembler'
import {beginConstruction,constructionStatus} from './video-construction'

function ready(){
 const p=createEmptyProject('Long multiplayer recording')
 const main=p.tracks.find(t=>t.role==='main')!
 const overlay=p.tracks.find(t=>t.name==='Overlay')!
 const voice=p.tracks.find(t=>t.name==='Voice')!
 const picture=createClip({kind:'video',trackId:main.id,start:0,duration:300,inPoint:120})
 picture.speed=1.5
 picture.groupId='group-original'
 const face=createClip({kind:'video',trackId:overlay.id,start:0,duration:300,inPoint:40})
 const sound=createClip({kind:'audio',trackId:voice.id,start:0,duration:300,inPoint:90})
 sound.groupId='group-original'
 p.clips[picture.id]=picture
 p.clips[face.id]=face
 p.clips[sound.id]=sound
 p.markers.push({id:'first-night',frame:12,label:'First night starts',color:'pink'})
 const s=beginConstruction(p,'Build a coherent, funny stream story without losing the rules',true)
 s.discoveryScans=[{id:'scanned',start:0,end:300,fingerprint:s.fingerprint,
   visualFrames:[0,150,299],audioMeasured:true,transcriptLines:0,eventCount:0}]
 s.inspections=[{id:'whole',start:0,end:300,mode:'overview',frames:[0,10,70,89,90,91,180,204,205,206,244,245,246,260,299],
   audio:true,transcript:false}]
 s.coverage=[{id:'c',start:0,end:300,visual:'Checked source visuals',audio:'Examined source audio cues',evidenceIds:['whole']}]
 s.beats=[
  {id:'hook',kind:'scene',start:180,end:260,summary:'Flash-forward opening',dependsOn:[],protectedRanges:[]},
  {id:'rules',kind:'setup',start:0,end:120,summary:'Explain the challenge rules',dependsOn:[],protectedRanges:[]},
  {id:'result',kind:'payoff',start:180,end:300,summary:'See the challenge outcome',dependsOn:['rules'],protectedRanges:[{start:210,end:220,reason:'The punchline lands here'}]}
 ]
 for(const c of s.sections!.context){c.indexed=true;c.summary='Actual source evidence reviewed';c.evidenceIds=['whole']}
 for(const e of s.sections!.editing){e.planned=true;e.summary='Global context linked';e.evidenceIds=['whole']}
 s.sourceSelections=[
  {id:'hook',role:'hook',beatId:'hook',start:205,end:245,reason:'Open with the surprising incident',evidenceIds:['whole']},
  {id:'setup',role:'setup',beatId:'rules',start:0,end:90,reason:'Explain why the challenge matters',evidenceIds:['whole']},
  {id:'ending',role:'ending',beatId:'result',start:180,end:300,reason:'Show the full payoff and final result',evidenceIds:['whole']}
 ]
 return {p,s,picture,face,sound}
}
describe('source-preserving keep-first editor',()=>{
 it('freezes exact original clip properties without making user edits',()=>{
  const {p,s,picture}=ready()
  const original=structuredClone(p.clips)
  expect(s.sourceManifest).toMatchObject({fingerprint:s.fingerprint})
  expect(s.sourceManifest!.clips[picture.id].inPoint).toBe(120)
  expect(captureConstructionManifest(p).clips[picture.id].speed).toBe(1.5)
  expect(p.clips).toEqual(original)
  expect(constructionStatus(p,s).stage).toBe('assemble')
 })
 it('reorders an opening hook, full setup and payoff without changing source clips',()=>{
  const {p,s,picture,face,sound}=ready(),before=structuredClone(p.clips)
  expect(validateKeepFirstSelections(p,s)).toHaveLength(3)
  const out=composeKeepFirstSequence(p,s,'Story Cut')
  validateOutputSourceMap(out,s.sourceManifest!)
  expect(out.outputFrames).toBe(250)
  expect(out.joins).toEqual([40,130])
  expect(out.selections.map(x=>x.role)).toEqual(['hook','setup','ending'])
  expect(out.selections.map(x=>x.sourceStart)).toEqual([205,0,180])
  expect(out.clips).toHaveLength(9)
  expect(out.clips.filter(x=>x.originalClipId===picture.id)).toHaveLength(3)
  expect(out.clips.filter(x=>x.originalClipId===face.id)).toHaveLength(3)
  expect(out.clips.filter(x=>x.originalClipId===sound.id)).toHaveLength(3)
  const firstPicture=out.sequence.clips[out.clips.find(x=>x.originalClipId===picture.id&&x.selectionId==='hook')!.outputClipId]
  expect(firstPicture.duration).toBe(40)
  expect(firstPicture.start).toBe(0)
  expect(firstPicture.speed).toBe(1.5)
  expect(firstPicture.inPoint).toBeGreaterThan(120)
  expect(out.sequence.markers).toEqual([expect.objectContaining({label:'First night starts',frame:52})])
  expect(p.clips).toEqual(before)
  expect(out.sequence.id).not.toEqual(p.sequence?.id)
 })
 it('preserves the video/audio group only within each assembled segment',()=>{
  const {p,s,picture,sound}=ready()
  const out=composeKeepFirstSequence(p,s)
  for(const sel of out.selections){
   const video=out.sequence.clips[out.clips.find(x=>x.selectionId===sel.selectionId&&x.originalClipId===picture.id)!.outputClipId]
   const audio=out.sequence.clips[out.clips.find(x=>x.selectionId===sel.selectionId&&x.originalClipId===sound.id)!.outputClipId]
   expect(video.groupId).toBe(audio.groupId)
  }
  const groups=out.selections.map(sel=>out.sequence.clips[out.clips.find(x=>x.selectionId===sel.selectionId&&x.originalClipId===picture.id)!.outputClipId].groupId)
  expect(new Set(groups).size).toBe(3)
 })
 it('rejects omitted protected events and omitted or reversed source setups',()=>{
  const {p,s}=ready()
  s.sourceSelections=s.sourceSelections!.filter(x=>x.id!=='ending')
  expect(()=>validateKeepFirstSelections(p,s)).toThrow(/ending/i)
  s.sourceSelections=[
   {id:'hook',role:'hook',beatId:'hook',start:205,end:245,reason:'Unexpected moment',evidenceIds:['whole']},
   {id:'ending',role:'ending',beatId:'result',start:180,end:300,reason:'Outcome',evidenceIds:['whole']},
  ]
  expect(()=>validateKeepFirstSelections(p,s)).toThrow(/Required setup/)
  s.sourceSelections=[
   {id:'setup',role:'setup',beatId:'rules',start:0,end:90,reason:'Rules explained',evidenceIds:['whole']},
   {id:'ending',role:'ending',beatId:'result',start:225,end:300,reason:'Outcome',evidenceIds:['whole']},
  ]
  expect(()=>validateKeepFirstSelections(p,s)).toThrow(/Protected story moment/)
 })
 it('blocks source-time escape, stale media and uninspected moments',()=>{
  const {p,s}=ready()
  s.sourceSelections![0].start=-1
  expect(()=>validateKeepFirstSelections(p,s)).toThrow(/Invalid|outside/i)
  s.sourceSelections![0].start=205
  s.sourceSelections![0].evidenceIds=['made-up']
  expect(()=>validateKeepFirstSelections(p,s)).toThrow(/inspected/)
  s.sourceSelections![0].evidenceIds=['whole']
  p.clips[Object.keys(p.clips)[0]].duration--
  expect(()=>composeKeepFirstSequence(p,s)).toThrow(/changed|source/i)
 })
 it('requires discovered keep/uncertain source moments, but permits evidenced discards',()=>{
  const {p,s}=ready()
  s.discoveryEvents=[{id:'missed-important',scanId:'scanned',signal:'visual-change',strength:1,
   description:'Potential silent event',start:100,end:110,visualFrames:[105],transcriptClipIds:[],sourceClipIds:[]}]
  expect(()=>validateKeepFirstSelections(p,s)).toThrow(/missed-important/)
  s.discoveryEvents[0].decision='discard'
  expect(validateKeepFirstSelections(p,s)).toHaveLength(3)
 })
 it('preserves immutable source snapshot across later clip changes to the temporary composition',()=>{
  const {p,s,picture}=ready()
  const before=cloneClip(s.sourceManifest!.clips[picture.id])
  const out=composeKeepFirstSequence(p,s)
  out.sequence.clips[out.clips[0].outputClipId].speed=9
  expect(s.sourceManifest!.clips[picture.id]).toEqual(before)
 })
})

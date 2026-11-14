import {describe,expect,it} from 'vitest'
import {createClip} from './defaults'
import {createEmptyProject} from './new-project'
import {beginConstruction} from './video-construction'
import {mapNarrativeMoments,validateNarrativeMoment,validateNarrativeStory,type NarrativeMoment} from './construction-narrative'
import type {SourceSelection} from './construction-assembler'
function ready(){
 const p=createEmptyProject('Five rounds')
 const c=createClip({kind:'video',trackId:p.tracks[0].id,start:0,duration:1200})
 p.clips[c.id]=c
 const s=beginConstruction(p,'Coherent gaming story',true)
 s.inspections=[{id:'whole',start:0,end:1200,frames:[0,300,600,900,1199],audio:true,transcript:true}]
 const moments:NarrativeMoment[]=[
  {id:'setup',kind:'joke-setup',start:0,end:60,description:'A direct on-camera joke sets up an eventual response',
   importance:'essential',confidence:'observed',evidenceIds:['whole'],links:[]},
  {id:'payoff',kind:'joke-payoff',start:810,end:850,description:'The on-camera reaction confirms the earlier prediction',
   importance:'essential',confidence:'observed',evidenceIds:['whole'],links:[{momentId:'setup',relation:'requires'}]},
  {id:'night-start',kind:'round-start',start:150,end:180,description:'Game visibly begins the next night',
   importance:'essential',confidence:'observed',evidenceIds:['whole'],links:[]},
  {id:'night-end',kind:'round-end',start:1010,end:1030,description:'The game visibly closes this night',
   importance:'essential',confidence:'observed',evidenceIds:['whole'],links:[{momentId:'night-start',relation:'requires'}]},
 ]
 s.narrativeMoments=moments
 const selection=(id:string,start:number,end:number,role:SourceSelection['role']):SourceSelection=>({
  id,start,end,role,beatId:'beat',reason:'Source-backed editorial context',evidenceIds:['whole'],
 })
 const picks=[
  selection('setup',0,90,'setup'),selection('night-start',140,200,'scene'),
  selection('payoff',790,900,'payoff'),selection('night-end',990,1100,'ending'),
 ]
 return {s,moments,picks,selection}
}
describe('source-grounded narrative continuity',()=>{
 it('protects essential challenge rules, joke setups and round endings',()=>{
  const {s,picks}=ready()
  const mapped=validateNarrativeStory(s,picks)
  expect(mapped.map(m=>m.momentId)).toEqual(['setup','night-start','payoff','night-end'])
  expect(mapped.find(m=>m.momentId==='payoff')).toMatchObject({
   sourceStart:810,sourceEnd:850,selectionId:'payoff',
  })
 })
 it('detects omitted critical moment even with a plausible video outline',()=>{
  const {s,picks}=ready()
  expect(()=>validateNarrativeStory(s,picks.filter(x=>x.id!=='night-start')))
   .toThrow(/Essential source moment night-start/)
 })
 it('rejects a joke payoff before its setup, but allows a cold-open preview followed by full explanation',()=>{
  const {s,picks,selection}=ready()
  expect(()=>validateNarrativeStory(s,[
    selection('payoff',790,900,'hook'),picks[0],picks[1],picks[3],
  ])).toThrow(/must follow/)
  const valid=[selection('teaser',810,850,'hook'),...picks]
  expect(validateNarrativeStory(s,valid).filter(x=>x.momentId==='payoff')).toHaveLength(2)
  expect(mapNarrativeMoments(s,valid).find(x=>x.selectionId==='teaser')!.outputStart).toBe(0)
 })
 it('blocks unsupported essential moments, missing evidence and unresolved link IDs',()=>{
  const {s,moments,picks}=ready()
  moments[0].confidence='uncertain'
  expect(()=>validateNarrativeMoment(s,moments[0])).toThrow(/uncertain/)
  moments[0].confidence='observed'
  moments[0].evidenceIds=['invented']
  expect(()=>validateNarrativeMoment(s,moments[0])).toThrow(/inspection/)
  moments[0].evidenceIds=['whole']
  moments[1].links=[{momentId:'nonexistent',relation:'requires'}]
  expect(()=>validateNarrativeStory(s,picks)).toThrow(/Unresolved narrative relationship/)
 })
 it('requires an explicit linked beginning for essential round/episode endings',()=>{
  const {s,picks,moments}=ready()
  moments[3].links=[]
  expect(()=>validateNarrativeStory(s,picks)).toThrow(/explicit linked beginning/)
 })
})

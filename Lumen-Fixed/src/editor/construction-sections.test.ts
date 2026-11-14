import {describe,expect,it} from 'vitest'
import {planConstructionSections,sectionTargets,selectBankContext,type BankedSection} from './construction-sections'

describe('duration-aware context banking and local editing',()=>{
 it('uses significantly larger context chunks, but bounded edit windows, for longer recordings',()=>{
  const short=sectionTargets(9*60,30)
  const long=sectionTargets(4*60*60,30)
  expect(long.contextTargetFrames).toBeGreaterThan(short.contextTargetFrames)
  expect(long.editTargetFrames).toBeGreaterThan(short.editTargetFrames)
  expect(long.contextTargetFrames).toBeGreaterThan(long.editTargetFrames)
  const p=planConstructionSections([{start:0,end:4*60*60*30}],30)
  expect(p.totalSeconds).toBe(4*60*60)
  expect(p.context.length).toBeLessThan(p.editing.length)
  expect(p.context.length).toBeLessThan(50)
  expect(p.editing.length).toBeLessThan(200)
  expect(p.editing.every(x=>(x.contextIds?.length??0)>=1)).toBe(true)
 })
 it('covers ALL authorised frames exactly without allowing excluded gaps or overlaps',()=>{
  const p=planConstructionSections([{start:30,end:2400},{start:2600,end:5400}],30)
  for(const sections of [p.context,p.editing]){
   expect(sections[0].start).toBe(30)
   expect(sections.at(-1)!.end).toBe(5400)
   expect(sections.every(c=>c.start>=30&&c.end<=5400&&
     !(c.start<2600&&c.end>2400))).toBe(true)
   for(let i=1;i<sections.length;i++){
    expect(sections[i].start>=sections[i-1].end).toBe(true)
    expect(sections[i].start-sections[i-1].end).toBe(sections[i].start===2600?200:0)
   }
  }
 })
 it('prefers an actual round/narrative boundary to a blind fixed time boundary',()=>{
  const p=planConstructionSections([{start:0,end:9000}],30,
   [{start:2600,end:2601,kind:'clip-boundary',strength:1},
    {start:5300,end:5301,kind:'audio-drop',strength:1}])
  expect(p.context[0].end).toBe(2600)
  expect(p.editing.some(x=>x.end===2600)).toBe(false) // Editing sections are shorter and keep own event context
 })
 it('searches the entire timeline bank, but returns only relevant local or distant context',()=>{
  const sections:BankedSection[]=[
   {id:'c1',start:0,end:900,indexed:true,summary:'The player promises a haunted toilet prank as a setup',keyMoments:['haunted toilet joke begins'],uncertainties:[]},
   {id:'c2',start:900,end:1800,indexed:true,summary:'Unrelated exploration through a corridor'},
   {id:'c3',start:1800,end:2700,indexed:true,summary:'Quiet side quest'},
   {id:'c4',start:2700,end:3600,indexed:true,summary:'Haunted toilet callback pays off much later'},
  ]
  const result=selectBankContext(sections,{start:2750,end:3200},'haunted toilet callback',['c1'],2)
  expect(result.map(x=>x.section.id)).toEqual(['c4','c1'])
  expect(result.map(x=>x.reason)).toEqual(['local','linked'])
  expect(selectBankContext(sections,{start:2750,end:3200},'exploration corridor',[],2).map(x=>x.section.id)).toContain('c2')
  expect(selectBankContext(sections,{start:2700,end:3600},'anything',[],1)).toHaveLength(1)
 })
 it('does not promote unbanked footage into verified global context',()=>{
  const bank:BankedSection[]=[
   {id:'unreviewed',start:0,end:900,summary:'Unverified joke theory'},
   {id:'reviewed',start:900,end:1800,indexed:true,summary:'Actual inspected dialogue'},
  ]
  expect(selectBankContext(bank,{start:0,end:900},'joke theory',[],8).map(x=>x.section.id)).toEqual(['reviewed'])
 })
 it('rejects invalid spans, overlapping source scopes and nonsense durations',()=>{
  expect(()=>planConstructionSections([],30)).toThrow()
  expect(()=>planConstructionSections([{start:0,end:100},{start:50,end:200}],30)).toThrow(/Overlapping/)
  expect(()=>planConstructionSections([{start:0,end:100}],0)).toThrow(/Invalid/)
 })
})

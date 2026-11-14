import {describe,expect,it} from 'vitest'
import {createEmptyProject} from './new-project'
import {createClip} from './defaults'
import {beginConstruction} from './video-construction'
import {pendingEventInvestigations,validateConstructionEventFinding,type ConstructionEventFinding} from './construction-event-findings'

function fixture(){
  const p=createEmptyProject('Recorded game')
  const c=createClip({kind:'video',trackId:p.tracks[0].id,start:0,duration:900})
  p.clips[c.id]=c
  const s=beginConstruction(p,'Find what actually happened',true)
  s.discoveryEvents=[
    {id:'visual-1',scanId:'scan-1',start:100,end:130,signal:'visual-change',
      strength:.95,description:'High image change signal',visualFrames:[108,120],sourceClipIds:[c.id],transcriptClipIds:[]},
    {id:'audio-1',scanId:'scan-1',start:400,end:430,signal:'audio-onset',
      strength:.7,description:'Sudden loudness signal',visualFrames:[],sourceClipIds:[c.id],transcriptClipIds:[]},
  ]
  s.inspections=[
    {id:'overview',start:100,end:130,frames:[100,129],mode:'overview',audio:true,transcript:false},
    {id:'focused',start:100,end:130,frames:[100,108,120,129],mode:'focused',audio:true,transcript:false},
    {id:'audio-focused',start:400,end:430,frames:[400,415,429],mode:'focused',audio:true,transcript:false},
  ]
  const finding:ConstructionEventFinding={eventId:'visual-1',kind:'gameplay',
    summary:'Source frames show a visible game-screen change at the inspected trigger',
    confidence:'observed',inspectionIds:['focused'],audioObservationIds:[],
    linkedMomentIds:[],uncertainty:'Precise gameplay meaning is not established by sampled images'}
  return {s,finding}
}
describe('real-evidence interpretation of discovered signals',()=>{
 it('never promotes visual signal candidates to observed gameplay from sparse overviews',()=>{
   const {s,finding}=fixture()
   expect(validateConstructionEventFinding(s,finding).id).toBe('visual-1')
   expect(()=>validateConstructionEventFinding(s,{...finding,inspectionIds:['overview']}))
     .toThrow(/focused|frame-by-frame/)
   s.inspections[1].frames=[100,120,129]
   expect(()=>validateConstructionEventFinding(s,finding)).toThrow(/trigger frame/)
 })
 it('requires actually recorded listening evidence for confident auditory humour or sound',()=>{
   const {s,finding}=fixture()
   const heard={...finding,eventId:'audio-1',kind:'laughter' as const,inspectionIds:['audio-focused']}
   expect(()=>validateConstructionEventFinding(s,heard)).toThrow(/real-audio listening/)
   s.audioSamples=[{id:'sample',start:400,end:430,fingerprint:s.fingerprint,purpose:'Listen to actual reaction'}]
   s.audioObservations=[{id:'heard',sampleId:'sample',eventType:'laughter',summary:'Audible laugh',
     audibleCues:'Repeated unvoiced pulses',confidence:'high',uncertainty:'Could be a player soundboard'}]
   expect(validateConstructionEventFinding(s,{...heard,audioObservationIds:['heard']}).id).toBe('audio-1')
   s.audioSamples[0].end=425
   expect(()=>validateConstructionEventFinding(s,{...heard,audioObservationIds:['heard']}))
     .toThrow(/does not cover/)
 })
 it('can record uncertainty without pretending loudness or visual changes explain what happened',()=>{
   const {s,finding}=fixture()
   const unknown={...finding,confidence:'uncertain' as const,kind:'unknown' as const,
     inspectionIds:['overview']}
   expect(validateConstructionEventFinding(s,unknown).id).toBe('visual-1')
   expect(()=>validateConstructionEventFinding(s,{...unknown,uncertainty:''})).toThrow(/state what remains unknown/)
 })
 it('prioritizes high-strength unverified original candidates without omitting unresolved ones',()=>{
   const {s,finding}=fixture()
   expect(pendingEventInvestigations(s).map(x=>x.id)).toEqual(['visual-1','audio-1'])
   s.eventFindings=[finding]
   expect(pendingEventInvestigations(s).map(x=>x.id)).toEqual(['audio-1'])
   s.discoveryEvents![1].decision='discard'
   expect(pendingEventInvestigations(s)).toEqual([])
 })
})

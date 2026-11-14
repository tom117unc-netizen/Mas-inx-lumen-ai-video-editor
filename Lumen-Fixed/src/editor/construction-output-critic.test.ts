import {describe,expect,it} from 'vitest'
import {auditOutputNarrative} from './construction-output-critic'
import {createEmptyProject} from './new-project'
import {constructionFingerprint,constructionStatus} from './video-construction'
import type {ConstructionState} from './video-construction'

function fixture():ConstructionState {
  const s={
    applied:{fingerprint:'output-v1',joins:[5,35,105]},
    assembly:{
      sequenceId:'new',sourceSequenceId:'original',sourceFingerprint:'original',
      clips:[],outputFrames:145,
      selections:[
        {selectionId:'hook',beatId:'h',role:'hook',sourceStart:110,sourceEnd:115,outputStart:0,outputEnd:5},
        {selectionId:'setup',beatId:'s',role:'setup',sourceStart:0,sourceEnd:30,outputStart:5,outputEnd:35},
        {selectionId:'round',beatId:'r',role:'scene',sourceStart:30,sourceEnd:100,outputStart:35,outputEnd:105},
        {selectionId:'end',beatId:'e',role:'ending',sourceStart:100,sourceEnd:140,outputStart:105,outputEnd:145},
      ],
      moments:[
        {momentId:'rule',kind:'rule',sourceStart:10,sourceEnd:15,selectionId:'setup',outputStart:15,outputEnd:20},
        {momentId:'start',kind:'round-start',sourceStart:35,sourceEnd:40,selectionId:'round',outputStart:40,outputEnd:45},
        {momentId:'end',kind:'round-end',sourceStart:110,sourceEnd:120,selectionId:'end',outputStart:115,outputEnd:125},
        {momentId:'finale',kind:'ending',sourceStart:125,sourceEnd:130,selectionId:'end',outputStart:130,outputEnd:135},
      ]
    },
    narrativeMoments:[
      {id:'rule',kind:'rule',start:10,end:15,description:'Challenge explanation',importance:'essential',confidence:'observed',evidenceIds:['source'],links:[]},
      {id:'start',kind:'round-start',start:35,end:40,description:'Round begins',importance:'essential',confidence:'observed',evidenceIds:['source'],links:[]},
      {id:'end',kind:'round-end',start:110,end:120,description:'Round outcome',importance:'essential',confidence:'observed',evidenceIds:['source'],links:[{momentId:'start',relation:'answers'}]},
      {id:'finale',kind:'ending',start:125,end:130,description:'Meaningful ending',importance:'essential',confidence:'observed',evidenceIds:['source'],links:[]},
    ],
    inspections:[{id:'output-overview',start:0,end:145,audio:true,
      frames:[16,42,118,132],transcript:true,mode:'overview'},
      ...[[15,20,16],[40,45,42],[115,125,118],[130,135,132]].map(([start,end,frame])=>({
        id:'focused-'+frame,start,end,audio:true,frames:Array.from({length:end-start},(_,i)=>start+i),
        transcript:true,mode:'focused'}))],
  }
  return s as unknown as ConstructionState
}
describe('skeptical independent structural critic of published video',()=>{
  it('accepts a complete, re-inspected source-backed output with a round beginning and outcome',()=>{
    const report=auditOutputNarrative(fixture())
    expect(report).toMatchObject({available:true,ok:true,checkedEssentialMoments:4,outputVerifiedMoments:4})
  })
  it('does not accept text claiming a good story if the round outcome was never inspected in the output',()=>{
    const s=fixture()
    s.inspections=s.inspections.filter(i=>i.id!=='focused-118')
    const report=auditOutputNarrative(s)
    expect(report.ok).toBe(false)
    expect(report.issues).toEqual(expect.arrayContaining([expect.stringMatching(/round-end.*focused re-inspection.*end/i)]))
  })
  it('fails if a round has no preserved result even though its start and premise are present',()=>{
    const s=fixture()
    s.assembly!.moments=s.assembly!.moments.filter(m=>m.momentId!=='end')
    expect(auditOutputNarrative(s).issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/round-end.*absent/i),
      expect.stringMatching(/lacks a linked later outcome/i),
    ]))
  })
  it('rejects a purported ending or critical context that survives only as a cold open teaser',()=>{
    const s=fixture()
    s.assembly!.moments=s.assembly!.moments.filter(m=>m.momentId!=='finale')
    s.assembly!.moments.push({momentId:'finale',kind:'ending',sourceStart:125,sourceEnd:130,
      selectionId:'hook',outputStart:0,outputEnd:5})
    expect(auditOutputNarrative(s).issues.join(' ')).toMatch(/mapping.*inconsistent|absent outside/i)
  })
  it('checks the original source coordinates and catches tampered output event placement',()=>{
    const s=fixture()
    s.assembly!.moments[0].outputStart++
    expect(auditOutputNarrative(s).issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/mapping is inconsistent/i),
    ]))
  })
  it('requires an explicit source event ledger for genuine reassembled edits',()=>{
    const s=fixture()
    s.narrativeMoments=[]
    s.assembly!.moments=[]
    expect(auditOutputNarrative(s).issues.join(' ')).toMatch(/no source-grounded narrative moment ledger/i)
    s.assembly!.selections=[{selectionId:'all',role:'complete',beatId:'all',sourceStart:0,sourceEnd:140,outputStart:0,outputEnd:140}]
    expect(auditOutputNarrative(s).issues).toEqual([])
  })
  it('does not trust earlier self-certified output reviews without the independent audit version',()=>{
    const p=createEmptyProject('Persisted assembled output')
    const s=fixture()
    s.projectId=p.id
    s.sequenceId=p.sequence?.id??'seq_main'
    s.fingerprint=constructionFingerprint(p)
    s.assembly!.sequenceId=s.sequenceId
    s.applied!.fingerprint=constructionFingerprint(p)
    s.review={fingerprint:s.applied!.fingerprint,joins:s.applied!.joins,story:'Story looks good',
      pacing:'Pacing looks good',issues:[]}
    expect(constructionStatus(p,s).complete).toBe(false)
    s.review.outputAuditVersion=1
    expect(constructionStatus(p,s).complete).toBe(true)
  })
  it('is unavailable for legacy cut-only construction (and never certifies semantic listening)',()=>{
    const s=fixture()
    s.assembly=undefined
    expect(auditOutputNarrative(s)).toMatchObject({available:false,ok:false})
    expect(auditOutputNarrative(fixture()).limitations).toMatch(/does NOT prove/)
  })
})

import {afterEach,describe,expect,it} from 'vitest'
import {createEmptyProject} from '@/editor/new-project'
import {createClip} from '@/editor/defaults'
import {beginConstruction, type ConstructionState} from '@/editor/video-construction'
import {getProject, recordVideoConstruction, useEditor} from '@/editor/store'
import {clearFinishedConstructionIndexJob,constructionIndexProgress,indexCoverage,nextIndexChunk,pauseConstructionIndexJob,startConstructionIndexJob} from './construction-index-worker'

function fixture() {
  const p=createEmptyProject('Four minute timeline')
  const clip=createClip({kind:'video',trackId:p.tracks[0].id,start:0,duration:2400})
  p.clips[clip.id]=clip
  useEditor.getState().loadProject(p)
  const s=beginConstruction(getProject(),'Index authorised footage only',true)
  recordVideoConstruction(p.id,s)
  return getProject().construction!
}
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0))
async function until(predicate:()=>boolean,limit=120){
  for(let i=0;i<limit&&!predicate();i++)await tick()
  if(!predicate())throw new Error('Local test worker never reached expected checkpoint')
}
afterEach(()=>{
  pauseConstructionIndexJob()
  clearFinishedConstructionIndexJob()
})
describe('resumable local construction indexing',()=>{
 it('plans exact unscanned chunks without crossing source gaps or rescanning saved coverage',()=>{
  const s=structuredClone(fixture())
  s.scope=[{start:0,end:200},{start:300,end:600}]
  s.discoveryScans=[{id:'a',start:0,end:100,fingerprint:s.fingerprint,visualFrames:[],audioMeasured:true,transcriptLines:0,eventCount:0}]
  expect(nextIndexChunk(s,150)).toEqual({start:100,end:200})
  expect(indexCoverage(s)).toMatchObject({total:500,done:100,remaining:400,percent:20})
  s.discoveryScans.push({id:'b',start:100,end:200,fingerprint:s.fingerprint,visualFrames:[],audioMeasured:true,transcriptLines:0,eventCount:0})
  expect(nextIndexChunk(s,150)).toEqual({start:300,end:450})
  expect(()=>nextIndexChunk(s,0)).toThrow(/budget/i)
 })
 it('indexes all original footage locally with one tool start and reliable saved checkpoints',async()=>{
  const s=fixture()
  const originalId=s.projectId
  const called:number[]=[]
  const runner=async(start:number,end:number)=>{
    called.push(start)
    const current=getProject().construction!
    expect(current.projectId).toBe(originalId)
    const next=structuredClone(current)
    next.discoveryScans!.push({id:`scan-${start}`,start,end,
      fingerprint:current.fingerprint,visualFrames:[start],audioMeasured:true,transcriptLines:0,eventCount:0})
    recordVideoConstruction(originalId,next)
    return {candidates:[]}
  }
  expect(startConstructionIndexJob(s,runner).state).toBe('running')
  expect(startConstructionIndexJob(getProject().construction!,runner).jobId).toBeTruthy()
  await until(()=>constructionIndexProgress(getProject().construction!).state==='completed')
  const done=getProject().construction!
  expect(constructionIndexProgress(done)).toMatchObject({
    state:'completed',indexedFrames:2400,totalFrames:2400,remainingFrames:0,percent:100,
  })
  expect(called).toEqual([0,1800])
  expect(done.discoveryScans?.map(x=>[x.start,x.end])).toEqual([[0,1800],[1800,2400]])
 })
 it('pauses between chunks and resumes strictly from saved progress',async()=>{
  const s=fixture()
  let scans=0
  const runner=async(start:number,end:number)=>{
    scans++
    const next=structuredClone(getProject().construction!)
    next.discoveryScans!.push({id:`saved-${scans}`,start,end,
      fingerprint:next.fingerprint,visualFrames:[start],audioMeasured:true,transcriptLines:0,eventCount:0})
    recordVideoConstruction(next.projectId,next)
    if(scans===1)pauseConstructionIndexJob()
    return {candidates:[]}
  }
  startConstructionIndexJob(s,runner)
  await until(()=>constructionIndexProgress(getProject().construction!).state==='paused')
  expect(indexCoverage(getProject().construction!).done).toBe(1800)
  clearFinishedConstructionIndexJob()
  startConstructionIndexJob(getProject().construction!,runner)
  await until(()=>constructionIndexProgress(getProject().construction!).state==='completed')
  expect(scans).toBe(2)
  expect(indexCoverage(getProject().construction!).done).toBe(2400)
 })
 it('halts on failed source scanning rather than inventing an indexed range',async()=>{
  const s=fixture()
  startConstructionIndexJob(s,async()=>{throw new Error('Media reader failed while decoding frame')})
  await until(()=>constructionIndexProgress(getProject().construction!).state==='failed')
  expect(indexCoverage(getProject().construction!).done).toBe(0)
  expect(constructionIndexProgress(getProject().construction!).error).toMatch(/reader failed/)
 })
})

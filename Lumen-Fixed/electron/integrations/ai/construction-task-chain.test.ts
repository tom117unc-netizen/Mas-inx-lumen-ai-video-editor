import { describe, expect, it } from 'vitest'
import {
  CONSTRUCTION_MAX_BATCHES, CONSTRUCTION_MICRO_STEPS, CONSTRUCTION_REQUEST_DEADLINE_MS,
  constructionRetryDelayMs, constructionTaskPrompt, isTransientConstructionError, waitForRetry,
} from './construction-task-chain'

describe('bounded persistent video-construction call chains',()=>{
 it('launches one resumable whole-video indexer rather than making an AI call for every minute',()=>{
  const prompt=constructionTaskPrompt({goal:'Edit the YapYap recording into a complete, funny video',
    fps:30,revision:6,status:{stage:'discover',uncovered:[{start:1800,end:9000}]},
    discoveryScans:{total:3},discoveryEvents:{total:15},discoveryPending:8})
  expect(prompt).toMatch(/\[1800, 3600\)/)
  expect(prompt).toMatch(/start_construction_indexing/)
  expect(prompt).toMatch(/Do NOT make a separate AI tool call for each minute/)
  expect(prompt).toMatch(/Goal: Edit the YapYap/)
  expect(prompt).toMatch(/revision=6/)
  expect(prompt).toMatch(/ONLY|Only the ORIGINAL authorised timeline footage/)
  expect(prompt).toMatch(/persist a durable checkpoint/)
  expect(prompt).not.toMatch(/\[1800, 9000\)/)
  const active=constructionTaskPrompt({status:{stage:'discover'},indexing:{state:'running',percent:48}})
  expect(active).toMatch(/already running/)
  expect(active).not.toMatch(/Start the one-call/)
 })
 it('requires one transcription job before any scan when source speech metadata is missing',()=>{
  const prompt=constructionTaskPrompt({status:{stage:'discover',uncovered:[{start:0,end:1800}]},
    missing_timeline_transcripts:['commentary','other-audio']})
  expect(prompt).toMatch(/ONE permitted audible asset.*commentary/)
  expect(prompt).toMatch(/More pending IDs: 1/)
  expect(prompt).not.toMatch(/Scan ONE/)
 })
 it('banks the whole timeline in fixed bounded calls before making local edit choices',()=>{
  const base={goal:'Five rounds with delayed callbacks',fps:30,revision:13,
    status:{stage:'context-bank',uncovered:[{start:0,end:7200}]},
    next_context_section:{id:'context-1',start:0,end:7200},
    sectionPlan:{context_target_frames:7200,edit_target_frames:1800,pending_context:1,pending_editing:4}}
  const first=constructionTaskPrompt({...base,next_context_probe:{section_id:'context-1',start:0,end:1800}})
  expect(first).toMatch(/GLOBAL CONTEXT BANKING PASS/)
  expect(first).toMatch(/\[0, 1800\)/)
  expect(first).toMatch(/Do not start choosing deletions/)
  const last=constructionTaskPrompt({...base,next_context_probe:null,
    next_context_inspection_ids:['overview-1','overview-2','overview-3','overview-4']})
  expect(last).toMatch(/record_construction_context_section/)
  expect(last).toMatch(/overview-4/)
 })
 it('uses all indexed source context when editing a small local section',()=>{
  const prompt=constructionTaskPrompt({status:{stage:'refine'},fps:30,
    next_edit_section:{id:'edit-12',start:14400,end:16200},
    sectionPlan:{pending_context:0,pending_editing:8,context_target_frames:5400,edit_target_frames:1800}})
  expect(prompt).toMatch(/edit-12/)
  expect(prompt).toMatch(/\[14400, 16200\)/)
  expect(prompt).toMatch(/get_construction_edit_context/)
  expect(prompt).toMatch(/record_construction_edit_section/)
  expect(prompt).toMatch(/ALL editing sections/)
 })
 it('restarts after interruption from the persisted checkpoint without reusing old edits',()=>{
  const prompt=constructionTaskPrompt({status:{stage:'investigate',uncovered:[{start:3000,end:3500}]},
    fps:25},'The previous short call hit its deadline')
  expect(prompt).toMatch(/\[3000, 3500\)/)
  expect(prompt).toMatch(/may have partially executed/)
  expect(prompt).toMatch(/do NOT replay unverified edits/)
 })
 it('chooses one review candidate rather than making broad deletion assumptions',()=>{
  expect(constructionTaskPrompt({status:{stage:'refine'},discoveryPending:4}))
    .toMatch(/get_discovery_queue/)
  expect(constructionTaskPrompt({status:{stage:'refine'},discoveryPending:4}))
    .toMatch(/record_construction_event_findings/)
  expect(constructionTaskPrompt({status:{stage:'review'}}))
    .toMatch(/ONE unfinished edited join/)
  expect(constructionTaskPrompt({status:{stage:'review'},review:{issues:['Missing opening rules']}}))
    .toMatch(/begin_construction_repair/)
  expect(constructionTaskPrompt({status:{stage:'review'},review:{issues:['Missing opening rules']}}))
    .toMatch(/Missing opening rules/)
 })
 it('uses finite micro-step and total batch limits',()=>{
  expect(CONSTRUCTION_MICRO_STEPS).toBeGreaterThan(1)
  expect(CONSTRUCTION_MICRO_STEPS).toBeLessThan(12)
  expect(CONSTRUCTION_MAX_BATCHES).toBeGreaterThan(12)
  expect(CONSTRUCTION_REQUEST_DEADLINE_MS).toBeGreaterThan(30_000)
 })
 it('retries only recoverable provider failures, including deadline aborts',()=>{
  for(const error of [
    {status:408},{statusCode:429},{response:{status:503}},
    {cause:{statusCode:502}}, {code:'ECONNRESET'},
    new Error('socket hang up'), new Error('fetch failed'),
  ]) expect(isTransientConstructionError(error)).toBe(true)
  expect(isTransientConstructionError({name:'AbortError'})).toBe(true)
  expect(isTransientConstructionError(new Error('unknown interruption'),true)).toBe(true)
  for(const error of [
    {status:400},{status:401},{status:403},{status:404},
    {status:422},new Error('Cut references a missing beat'),
    new Error('User cancelled this edit'), {status:429,message:'irrelevant'},
  ].slice(0,-1))expect(isTransientConstructionError(error)).toBe(false)
  // A known 429 is retriable even if its message is unhelpful.
  expect(isTransientConstructionError({status:429,message:'irrelevant'})).toBe(true)
 })
 it('does not crash on circular provider error metadata',()=>{
  const error:{code:string;cause?:unknown}={code:'ECONNRESET'}
  error.cause=error
  expect(isTransientConstructionError(error)).toBe(true)
 })
 it('applies a finite escalating delay with extra caution after rate limiting',()=>{
  expect(constructionRetryDelayMs(1,{status:503})).toBe(750)
  expect(constructionRetryDelayMs(2,{status:503})).toBe(1500)
  expect(constructionRetryDelayMs(3,{status:429})).toBe(10_000)
  expect(constructionRetryDelayMs(100,{})).toBeLessThanOrEqual(12_000)
  expect(()=>constructionRetryDelayMs(0,{})).toThrow()
 })
 it('honours explicit cancellation while waiting between requests',async()=>{
  const controller=new AbortController()
  controller.abort()
  await expect(waitForRetry(2_000,controller.signal)).rejects.toBeDefined()
  await expect(waitForRetry(0,new AbortController().signal)).resolves.toBeUndefined()
 })
})

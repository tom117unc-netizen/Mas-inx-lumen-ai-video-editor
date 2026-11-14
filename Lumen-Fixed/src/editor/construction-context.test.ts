import { describe, expect, it } from 'vitest'
import { createEmptyProject } from './new-project'
import { createClip } from './defaults'
import { beginConstruction, updateConstruction } from './video-construction'
import { relatedStoryContext, speechCutContext } from './construction-context'

function story() {
  const p = createEmptyProject('Continuity')
  const clip = createClip({kind:'video',trackId:p.tracks[0].id,start:0,duration:600})
  p.clips[clip.id] = clip
  const started = beginConstruction(p,'Protect setups and later callbacks')
  started.inspections.push({id:'receipt',start:0,end:600,frames:[0,100,200,300,400,500],audio:true,transcript:true})
  const s = updateConstruction(started,{beats:[
    {id:'intro',start:0,end:100,kind:'setup',summary:'Find the cursed key'},
    {id:'middle',start:100,end:300,kind:'scene',summary:'Long journey',dependsOn:['intro']},
    {id:'ending',start:300,end:600,kind:'callback',summary:'Use the cursed key',dependsOn:['intro']}
  ],cuts:[{id:'travel',start:150,end:200,beatId:'middle',reason:'Walking',audioReason:'Speech checked',visualReason:'Nothing needed',evidenceIds:['receipt']}]})
  // A live inspection is required for real cuts. This pure test only checks the context graph.
  return {p,s}
}

describe('cross-scene contextual investigation',()=>{
  it('surfaces distant source setups and callbacks, not just nearby seconds',()=>{
    const {s}=story()
    const c=relatedStoryContext(s,'travel')
    expect(c.focus.id).toBe('middle')
    expect(c.dependencies.map(b=>b.id)).toContain('intro')
    expect(c.related.map(b=>b.id)).toContain('ending')
    expect(c.nearby.map(b=>b.id)).toContain('ending')
    expect(c.cut.id).toBe('travel')
  })
  it('rejects unknown cut IDs',()=>{
    expect(()=>relatedStoryContext(story().s,'missing')).toThrow(/cut/i)
  })
})

describe('spoken boundary safety',()=>{
  function scripted() {
    const {p,s}=story()
    const clip=Object.values(p.clips)[0]
    clip.assetId='source'
    p.assets.source={id:'source',name:'Stream',kind:'video',hasAudio:true,duration:20,addedAt:1,
      source:{type:'file',url:'file://stream.mp4',mime:'video/mp4',size:1},
      transcript:[
        {start:3.0,end:4.0,text:'Here is the setup'},
        {start:5.0,end:6.5,text:'Wait, I have a plan'},
        {start:7.0,end:8.0,text:'It worked!'}
      ]}
    return {p,s}
  }
  it('detects cut starts and ends inside utterances and shows the words',()=>{
    const {p}=scripted()
    const report=speechCutContext(p,{start:160,end:188},12)
    expect(report.violations.map(v=>v.edge)).toContain('start')
    expect(report.violations.map(v=>v.edge)).toContain('end')
    expect(report.violations[0].line.text).toMatch(/plan/)
  })
  it('allows boundaries in known transcript gaps while retaining before and after',()=>{
    const {p}=scripted()
    const report=speechCutContext(p,{start:123,end:147},12)
    expect(report.violations).toEqual([])
    expect(report.before.some(v=>v.text.includes('setup'))).toBe(true)
    expect(report.removed).toEqual([])
    expect(report.after.some(v=>v.text.includes('plan'))).toBe(true)
  })
})

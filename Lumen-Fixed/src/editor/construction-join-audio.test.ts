import { describe,expect,it } from 'vitest'
import { assessJoinAudio } from './construction-join-audio'

const mono=(data:Float32Array,rate=48000)=>assessJoinAudio([data],rate,Math.floor(data.length/2))
const fill=(left:number,right:number,n=48000)=>{
  const d=new Float32Array(n)
  d.fill(left,0,n/2);d.fill(right,n/2)
  return d
}
describe('actual timeline mix join diagnostics',()=>{
  it('does not call silence a verified audible transition',()=>{
    const r=mono(fill(0,0))
    expect(r.audible).toBe(false)
    expect(r.flags).toContain('silent-or-unverifiable')
    expect(r.flags).not.toContain('possible-click')
  })
  it('flags a large step change as possible click, not definite audible corruption',()=>{
    const r=mono(fill(0.35,-0.65))
    expect(r.audible).toBe(true)
    expect(r.flags).toContain('possible-click')
    expect(r.discontinuity).toBeGreaterThan(0.9)
  })
  it('does not flag normal steady signal as a click',()=>{
    const d=new Float32Array(48000)
    for(let i=0;i<d.length;i++)d[i]=0.25*Math.sin(i*2*Math.PI*440/48000)
    const r=mono(d)
    expect(r.audible).toBe(true)
    expect(r.flags).not.toContain('possible-click')
  })
  it('reports a sudden silence-to-sound transition as a review lead',()=>{
    const r=mono(fill(0,0.25))
    expect(r.flags).toContain('abrupt-level-shift')
  })
  it('rejects unusable or out-of-bounds sample data',()=>{
    expect(()=>assessJoinAudio([],48000,200)).toThrow(/channels/i)
    expect(()=>assessJoinAudio([new Float32Array(200)],0,100)).toThrow(/sample rate/i)
    expect(()=>assessJoinAudio([new Float32Array(200)],48000,200)).toThrow(/join/i)
  })
})

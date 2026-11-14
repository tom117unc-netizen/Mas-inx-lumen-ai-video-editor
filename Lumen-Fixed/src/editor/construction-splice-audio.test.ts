import {describe,expect,it} from 'vitest'
import {previewAudioSplice} from './construction-splice-audio'

const buffer=(data:number[],rate=24000,channels=1)=>({
  sampleRate:rate,numberOfChannels:channels,length:data.length,
  getChannelData:(_c:number)=>new Float32Array(data),
})
describe('pre-publish real-audio splice handles',()=>{
 it('joins the actual last original samples to the first samples of the next chosen moment',()=>{
   const a=buffer([.2,.1,0,0]),b=buffer([0,.3,.4,.5])
   const result=previewAudioSplice(a,b)
   expect(result.joinSample).toBe(4)
   expect([...result.pcm.getChannelData(0)]).toEqual(expect.arrayContaining([.2]))
   expect(result.pcm.getChannelData(0)).toHaveLength(8)
   expect(result.pcm.getChannelData(0)[3]).toBe(0)
   expect(result.pcm.getChannelData(0)[5]).toBeCloseTo(.3,5)
 })
 it('warns on an audible splice click and measured sudden level changes',()=>{
   const l=buffer(Array.from({length:1000},()=>.7))
   const r=buffer(Array.from({length:1000},()=>-.7))
   const result=previewAudioSplice(l,r)
   expect(result.report.flags).toContain('possible-click')
   expect(result.report.discontinuity).toBeGreaterThan(1)
   const sudden=previewAudioSplice(buffer(new Array(1000).fill(0)),buffer(new Array(1000).fill(.4)))
   expect(sudden.report.flags).toContain('abrupt-level-shift')
 })
 it('does not certify silence as evidence of sound quality',()=>{
   expect(previewAudioSplice(buffer([0,0]),buffer([0,0])).report.flags).toContain('silent-or-unverifiable')
 })
 it('rejects mismatched channels, rate or absurd durations rather than mixing unrelated samples',()=>{
   expect(()=>previewAudioSplice(buffer([0,0]),buffer([0,0],48000))).toThrow(/rates/i)
   expect(()=>previewAudioSplice(buffer([0,0]),buffer([0,0],24000,2))).toThrow(/channel/i)
   expect(()=>previewAudioSplice(buffer([0,0]),buffer([]))).toThrow(/length/i)
   expect(()=>previewAudioSplice(buffer(new Array(13*24000).fill(0)),buffer([0]))).toThrow(/12 seconds/)
 })
})

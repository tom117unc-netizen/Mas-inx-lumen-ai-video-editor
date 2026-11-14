import {describe,expect,it} from 'vitest'
import {canReceiveTimelineAudio,validateAudioPayload} from './audio-transport'

describe('explicit audio-capable model routing',()=>{
 it('permits only selected Gemini general models, not a text-only or unknown provider',()=>{
  expect(canReceiveTimelineAudio('gemini','gemini-2.5-flash')).toBe(true)
  expect(canReceiveTimelineAudio('gemini','gemini-3-pro')).toBe(true)
  expect(canReceiveTimelineAudio('openai','gpt-6')).toBe(false)
  expect(canReceiveTimelineAudio('ollama','gemini-2.5-flash')).toBe(false)
  expect(canReceiveTimelineAudio('gemini','imagen-4')).toBe(false)
 })
 it('accepts one capped WAV but rejects malformed and oversized audio',()=>{
  expect(validateAudioPayload({mimeType:'audio/wav',data:'UklGRg=='})).toEqual({mimeType:'audio/wav',data:'UklGRg=='})
  expect(()=>validateAudioPayload({mimeType:'audio/mpeg',data:'AAAA'})).toThrow(/WAV/i)
  expect(()=>validateAudioPayload({mimeType:'audio/wav',data:'@@@'})).toThrow(/base64/i)
  expect(()=>validateAudioPayload({mimeType:'audio/wav',data:'A'.repeat(4_000_001)})).toThrow(/size/i)
 })
})

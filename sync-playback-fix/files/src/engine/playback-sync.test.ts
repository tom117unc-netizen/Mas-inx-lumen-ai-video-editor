import { describe, expect, it } from 'vitest'
import { initialPlaybackWindow, playbackVoiceKey } from './playback-sync'

describe('initialPlaybackWindow', () => {
  it('prepares the first chunk of audio that is already audible at the playhead', () => {
    expect(initialPlaybackWindow(10, 40, 20, 8)).toEqual([20, 28])
  })

  it('starts at the clip start when the clip begins on the playhead', () => {
    expect(initialPlaybackWindow(20, 40, 20, 8)).toEqual([20, 28])
  })

  it('does not block playback for audio that begins well in the future', () => {
    expect(initialPlaybackWindow(25, 40, 20, 8)).toBeNull()
  })

  it('clips the prepared window at the end of the audible voice', () => {
    expect(initialPlaybackWindow(10, 23, 20, 8)).toEqual([20, 23])
  })
})

describe('playbackVoiceKey', () => {
  it('distinguishes the same nested clip used at different timeline offsets', () => {
    expect(playbackVoiceKey('clip', 0)).not.toBe(playbackVoiceKey('clip', 12))
  })
})

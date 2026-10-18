import { describe, expect, it } from 'vitest'
import { PlaybackStartGate } from './playback-start'

describe('PlaybackStartGate', () => {
  it('invalidates an older pending start when a newer start begins', () => {
    const gate = new PlaybackStartGate()
    const first = gate.begin()
    const second = gate.begin()
    expect(gate.isCurrent(first)).toBe(false)
    expect(gate.isCurrent(second)).toBe(true)
  })

  it('invalidates a pending start when playback is cancelled', () => {
    const gate = new PlaybackStartGate()
    const start = gate.begin()
    gate.cancel()
    expect(gate.isCurrent(start)).toBe(false)
  })
})

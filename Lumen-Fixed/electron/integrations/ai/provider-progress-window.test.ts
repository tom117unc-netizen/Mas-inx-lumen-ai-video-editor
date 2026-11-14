import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProviderProgressWindow } from './provider-progress-window'

afterEach(() => vi.useRealTimers())

describe('AI provider bounded progress window', () => {
  it('resets the idle deadline after each real model or tool progress event', () => {
    vi.useFakeTimers()
    const window = createProviderProgressWindow(100, 500)
    vi.advanceTimersByTime(80)
    expect(window.signal.aborted).toBe(false)
    window.progress() // A completed tool result permits another model step.
    vi.advanceTimersByTime(80)
    expect(window.signal.aborted).toBe(false)
    vi.advanceTimersByTime(21)
    expect(window.signal.aborted).toBe(true)
    expect((window.signal.reason as Error).message).toContain('no progress')
    window.close()
  })

  it('has a hard total cap even when model keeps streaming output', () => {
    vi.useFakeTimers()
    const window = createProviderProgressWindow(100, 250)
    vi.advanceTimersByTime(75)
    window.progress()
    vi.advanceTimersByTime(75)
    window.progress()
    vi.advanceTimersByTime(75)
    window.progress()
    expect(window.signal.aborted).toBe(false)
    vi.advanceTimersByTime(25)
    expect(window.signal.aborted).toBe(true)
    expect((window.signal.reason as Error).message).toContain('hard execution cap')
    window.close()
  })

  it('closes timers without aborting a successful response', () => {
    vi.useFakeTimers()
    const window = createProviderProgressWindow(100, 250)
    window.close()
    vi.advanceTimersByTime(1000)
    expect(window.signal.aborted).toBe(false)
  })

  it('rejects invalid watchdog limits', () => {
    expect(() => createProviderProgressWindow(0)).toThrow()
    expect(() => createProviderProgressWindow(300, 200)).toThrow()
  })
})

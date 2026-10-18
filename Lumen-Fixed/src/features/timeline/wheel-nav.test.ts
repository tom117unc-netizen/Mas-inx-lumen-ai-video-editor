import { describe, expect, it } from 'vitest'
import { timelinePanDelta } from './wheel-nav'

describe('timelinePanDelta', () => {
  it('uses vertical wheel movement as horizontal timeline movement while Ctrl is held', () => {
    expect(timelinePanDelta({ ctrlKey: true, metaKey: false, deltaX: 0, deltaY: 120 })).toBe(120)
  })

  it('keeps native wheel behaviour when Ctrl/Command is not held', () => {
    expect(timelinePanDelta({ ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 120 })).toBeNull()
  })

  it('uses a trackpad horizontal delta when it is larger', () => {
    expect(timelinePanDelta({ ctrlKey: true, metaKey: false, deltaX: -90, deltaY: 20 })).toBe(-90)
  })
})

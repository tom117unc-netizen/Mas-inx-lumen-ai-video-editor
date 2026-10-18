export interface TimelineWheelLike {
  ctrlKey: boolean
  metaKey: boolean
  deltaX: number
  deltaY: number
}

/**
 * Ctrl/Command + wheel pans the timeline horizontally. Returning null means
 * Lumen should leave the wheel event alone.
 */
export function timelinePanDelta(event: TimelineWheelLike): number | null {
  if (!(event.ctrlKey || event.metaKey)) return null
  return Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
}

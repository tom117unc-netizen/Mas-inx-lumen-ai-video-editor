/** Audio beginning within this many seconds counts as starting on the playhead. */
const START_EPSILON = 0.05

/**
 * The initial played-timeline window that must be ready before picture starts.
 * Later audio is handled by the existing streaming lookahead.
 */
export function initialPlaybackWindow(voiceStart: number, voiceEnd: number, from: number, chunkSeconds: number): [number, number] | null {
  if (voiceEnd <= from || voiceStart > from + START_EPSILON) return null
  const start = Math.max(from, voiceStart)
  return [start, Math.min(voiceEnd, start + chunkSeconds)]
}

/** Stable enough for a clip used in a nested timeline at a particular offset. */
export function playbackVoiceKey(clipId: string, offset: number) {
  return `${clipId}|${offset.toFixed(6)}`
}

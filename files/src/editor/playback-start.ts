/**
 * Invalidates asynchronous playback starts. Seeking, pausing, or pressing play
 * again must prevent an older audio-preparation promise from starting playback.
 */
export class PlaybackStartGate {
  private generation = 0

  begin() {
    return ++this.generation
  }

  cancel() {
    this.generation++
  }

  isCurrent(token: number) {
    return token === this.generation
  }
}

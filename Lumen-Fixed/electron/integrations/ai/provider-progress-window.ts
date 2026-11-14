/** A model step can finish successfully just before the next model step starts.
 * Reset the idle watchdog only after real stream progress, not on unrelated
 * polling or elapsed wall-clock time. Keep a hard batch cap as a second limit.
 *
 * The returned abort signal must be combined with the user's cancellation
 * signal. Cancellation never changes editor checkpoints or silently retries.
 */
export const CONSTRUCTION_BATCH_HARD_CAP_MS = 12 * 60_000

export function createProviderProgressWindow(idleMs: number, hardMs = CONSTRUCTION_BATCH_HARD_CAP_MS) {
  if (!Number.isFinite(idleMs) || idleMs < 1 || !Number.isFinite(hardMs) || hardMs < idleMs)
    throw new Error('Invalid provider progress watchdog limits')
  const controller = new AbortController()
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let closed = false
  const fail = (reason: string) => {
    if (!closed && !controller.signal.aborted) controller.abort(new Error(reason))
  }
  const progress = () => {
    if (closed || controller.signal.aborted) return
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => fail('AI provider produced no progress within its bounded response window'), idleMs)
  }
  const hardTimer = setTimeout(() => fail('AI provider batch exceeded its hard execution cap'), hardMs)
  progress()
  const close = () => {
    closed = true
    if (idleTimer) clearTimeout(idleTimer)
    clearTimeout(hardTimer)
  }
  return { signal: controller.signal, progress, close }
}

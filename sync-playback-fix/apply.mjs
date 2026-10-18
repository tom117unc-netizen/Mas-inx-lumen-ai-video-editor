import fs from 'node:fs'
import path from 'node:path'

const repo = process.argv[2] || 'D:\\Lumenfix\\Lumen-Fixed'
const packageRoot = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).replaceAll('/', path.sep)

function read(rel) {
  return fs.readFileSync(path.join(repo, rel), 'utf8')
}
function write(rel, text) {
  fs.writeFileSync(path.join(repo, rel), text, 'utf8')
}
function backup(rel) {
  const full = path.join(repo, rel)
  fs.copyFileSync(full, `${full}.before-sync-playback.bak`)
}
function replaceOnce(text, oldText, newText, label) {
  const first = text.indexOf(oldText)
  if (first < 0) throw new Error(`Could not find expected ${label}. Nothing was written.`)
  if (text.indexOf(oldText, first + 1) >= 0) throw new Error(`Expected ${label} once but found it more than once. Nothing was written.`)
  return text.slice(0, first) + newText + text.slice(first + oldText.length)
}

const playbackPath = 'src/editor/playback.ts'
const audioPath = 'src/engine/audio-engine.ts'
const timelinePath = 'src/features/timeline/Timeline.tsx'

let playback = read(playbackPath)
let audio = read(audioPath)
let timeline = read(timelinePath)

// Validate every marker before touching the tree.
const required = [
  [playback, "import { create } from 'zustand'", 'playback imports'],
  [playback, "function anchor(frame: number, rate: number)", 'playback anchor'],
  [audio, "const CHUNK = 8", 'audio streaming constants'],
  [audio, "start(project: Project, from: number): number", 'audioEngine.start'],
  [audio, "function scheduleAll(project: Project, from: number, at: number)", 'scheduleAll'],
  [timeline, "const onWheel = (e: WheelEvent) => {", 'timeline wheel handler'],
]
for (const [text, marker, label] of required) {
  if (!text.includes(marker)) throw new Error(`Current source does not match expected ${label}: ${marker}`)
}

// ---- playback.ts ----
playback = replaceOnce(
  playback,
  "import { create } from 'zustand'\n",
  "import { create } from 'zustand'\nimport { PlaybackStartGate } from './playback-start'\n",
  'playback helper import',
)

const oldAnchor = `/** Restarts the clock (and the sound) at \`frame\`. */
function anchor(frame: number, rate: number) {
  anchorFrame = frame
  anchorTime = performance.now()
  if (rate === 1) anchorAudio = audioEngine.start(useEditor.getState().project, frame / fps())
  else {
    anchorAudio = null
    audioEngine.stop()
  }
}
`
const newAnchor = `const startGate = new PlaybackStartGate()

function startTicking() {
  if (!raf) raf = requestAnimationFrame(tick)
}

/** Restarts the clock at \`frame\`, holding picture until normal-speed audio is ready. */
function anchor(frame: number, rate: number) {
  anchorFrame = frame
  anchorTime = performance.now()

  if (rate !== 1) {
    startGate.cancel()
    anchorAudio = null
    audioEngine.stop()
    startTicking()
    return
  }

  const token = startGate.begin()
  anchorAudio = null

  void audioEngine
    .start(useEditor.getState().project, frame / fps())
    .then((at) => {
      const state = usePlayback.getState()
      if (!startGate.isCurrent(token) || !state.playing || state.rate !== 1) return
      // The audio engine chose this anchor only after its first audible chunk
      // was prepared. Start the picture clock from that same audio instant.
      anchorFrame = frame
      anchorAudio = at
      anchorTime = performance.now()
      startTicking()
    })
    .catch((err) => {
      console.warn('Audio could not start in sync; continuing picture playback', err)
      const state = usePlayback.getState()
      if (!startGate.isCurrent(token) || !state.playing || state.rate !== 1) return
      anchorFrame = frame
      anchorAudio = null
      anchorTime = performance.now()
      startTicking()
    })
}
`
playback = replaceOnce(playback, oldAnchor, newAnchor, 'playback anchor function')

const oldLoop = `    anchor(restart, rate)
    f = restart
`
const newLoop = `    if (rate === 1) {
      // Normal-speed looping waits for the first audio chunk at the loop point
      // before picture advances again.
      raf = 0
      usePlayback.setState({ frame: restart })
      anchor(restart, rate)
      return
    }
    anchor(restart, rate)
    f = restart
`
playback = replaceOnce(playback, oldLoop, newLoop, 'loop restart')

const oldPlay = `  play(rate = 1) {
    inToOut = false
    let start = usePlayback.getState().frame
    if (rate > 0 && start >= endFrame() - 1) start = 0
    anchor(start, rate)
    usePlayback.setState({ playing: true, rate, frame: start })
    if (!raf) raf = requestAnimationFrame(tick)
  },
`
const newPlay = `  play(rate = 1) {
    inToOut = false
    let start = usePlayback.getState().frame
    if (rate > 0 && start >= endFrame() - 1) start = 0
    usePlayback.setState({ playing: true, rate, frame: start })
    anchor(start, rate)
  },
`
playback = replaceOnce(playback, oldPlay, newPlay, 'play method')

const oldInOut = `    playback.pause()
    inToOut = true
    anchor(range.in, 1)
    usePlayback.setState({ playing: true, rate: 1, frame: range.in })
    if (!raf) raf = requestAnimationFrame(tick)
`
const newInOut = `    playback.pause()
    inToOut = true
    usePlayback.setState({ playing: true, rate: 1, frame: range.in })
    anchor(range.in, 1)
`
playback = replaceOnce(playback, oldInOut, newInOut, 'playInToOut start')

const oldPause = `  pause() {
    cancelAnimationFrame(raf)
    raf = 0
    inToOut = false
    anchorAudio = null
    audioEngine.stop()
`
const newPause = `  pause() {
    startGate.cancel()
    cancelAnimationFrame(raf)
    raf = 0
    inToOut = false
    anchorAudio = null
    audioEngine.stop()
`
playback = replaceOnce(playback, oldPause, newPause, 'pause cancellation')

const oldSeek = `  seek(frame: number) {
    const f = Math.max(0, Math.round(frame))
    const { playing, rate } = usePlayback.getState()
    if (playing) anchor(f, rate)
    else {
      anchorFrame = f
      anchorTime = performance.now()
    }
    usePlayback.setState(playing ? { frame: f } : { frame: f, pausedFrame: f })
  },
`
const newSeek = `  seek(frame: number) {
    const f = Math.max(0, Math.round(frame))
    const { playing, rate } = usePlayback.getState()
    if (playing) {
      startGate.cancel()
      cancelAnimationFrame(raf)
      raf = 0
      usePlayback.setState({ frame: f })
      anchor(f, rate)
    } else {
      anchorFrame = f
      anchorTime = performance.now()
      usePlayback.setState({ frame: f, pausedFrame: f })
    }
  },
`
playback = replaceOnce(playback, oldSeek, newSeek, 'seek method')

const oldShuttle = `    anchor(usePlayback.getState().frame, next)
    usePlayback.setState({ playing: true, rate: next })
    if (!raf) raf = requestAnimationFrame(tick)
`
const newShuttle = `    usePlayback.setState({ playing: true, rate: next })
    anchor(usePlayback.getState().frame, next)
`
playback = replaceOnce(playback, oldShuttle, newShuttle, 'shuttle method')

// ---- audio-engine.ts ----
audio = replaceOnce(
  audio,
  "import { resample } from './wav'\n",
  "import { resample } from './wav'\nimport { initialPlaybackWindow, playbackVoiceKey } from './playback-sync'\n",
  'audio sync helper import',
)

const oldVoice = `/** A clip whose sound is heard, where it goes, and how its timeline lines up with the one being played. */
interface Voice {
  clip: Clip
  /** The timeline the clip is on (a nested one for clips inside nests). */
  view: Project
  dest: AudioNode
  /** Seconds added to a time on the clip's timeline give the time on the played one. */
  offset: number
  /** The stretch of the played timeline it can be heard in (inside its nested clip). */
  window: [number, number]
}

/** Played-timeline seconds a voice is heard for. */
function voiceSpan(v: Voice): [number, number] {
`
const newVoice = `/** Timing shared by a live voice and by its pre-playback preparation. */
interface VoiceTiming {
  clip: Clip
  /** The timeline the clip is on (a nested one for clips inside nests). */
  view: Project
  /** Seconds added to a time on the clip's timeline give the time on the played one. */
  offset: number
  /** The stretch of the played timeline it can be heard in (inside its nested clip). */
  window: [number, number]
}

/** A timed voice plus the AudioNode it feeds. */
interface Voice extends VoiceTiming {
  dest: AudioNode
}

/** Played-timeline seconds a voice is heard for. */
function voiceSpan(v: VoiceTiming): [number, number] {
`
audio = replaceOnce(audio, oldVoice, newVoice, 'Voice timing interface')

const disposeMarker = `function disposeNest(nodes: NestNodes) {`
const timedVoices = `/**
 * The audible leaves and their timeline alignment, without creating AudioNodes.
 * Used to prepare exactly the audio that must exist before picture starts.
 */
function timedVoices(project: Project): VoiceTiming[] {
  const out: VoiceTiming[] = []
  const walk = (view: Project, offset: number, window: [number, number], level: number) => {
    const fps = view.settings.fps
    for (const clip of Object.values(view.clips)) {
      if (isAudible(view, clip)) {
        out.push({ clip, view, offset, window })
        continue
      }
      if (level >= MAX_NESTING || !nestHeard(view, clip)) continue
      const inner = sequenceView(view, clip.sequenceId!)
      if (!inner || inner === view) continue
      const xf = crossfades(view, clip)
      const t0 = clip.start / fps + offset
      const t1 = (clipEnd(clip) + xf.tail) / fps + offset
      const nestedWindow: [number, number] = [Math.max(window[0], t0), Math.min(window[1], t1)]
      if (nestedWindow[1] - nestedWindow[0] <= 1e-4) continue
      walk(inner, offset + (clip.start - clip.inPoint) / fps, nestedWindow, level + 1)
    }
  }
  walk(project, 0, [-Infinity, Infinity], 0)
  return out
}

`
audio = replaceOnce(audio, disposeMarker, timedVoices + disposeMarker, 'timed voice insertion')

const chunkMarker = `const LOOKAHEAD = 12
const CHUNK = 8
`
const preparedCode = `const LOOKAHEAD = 12
const CHUNK = 8

interface PreparedPlaybackStart {
  short: Map<string, AudioBuffer>
  long: Map<string, { buffer: AudioBuffer; bufferStart: number; from: number; to: number }>
}

/**
 * Prepare only audio that must be heard on the very first playback frame.
 * Long recordings read their first normal streaming chunk here; the existing
 * lookahead takes over after playback starts.
 */
async function preparePlaybackStart(project: Project, from: number): Promise<PreparedPlaybackStart> {
  const prepared: PreparedPlaybackStart = { short: new Map(), long: new Map() }
  await Promise.all(
    timedVoices(project).map(async (v) => {
      const [voiceStart, voiceEnd] = voiceSpan(v)
      const window = initialPlaybackWindow(voiceStart, voiceEnd, from, CHUNK)
      if (!window) return
      const asset = v.view.assets[v.clip.assetId!]
      const key = playbackVoiceKey(v.clip.id, v.offset)
      try {
        if (isLongAudio(asset)) {
          const [a, b] = window
          const [s0, s1] = sourceSpan(v.view, v.clip, a - v.offset, b - v.offset)
          const chunk = await streamChunk(asset, v.clip, s0, s1)
          if (chunk) prepared.long.set(key, { buffer: chunk.buffer, bufferStart: chunk.start, from: a, to: b })
          return
        }
        const buffer = await clipBuffer(asset, v.clip)
        if (buffer) prepared.short.set(key, buffer)
      } catch (err) {
        console.warn('Couldn’t prepare audio for synchronized playback', err)
      }
    }),
  )
  return prepared
}
`
audio = replaceOnce(audio, chunkMarker, preparedCode, 'playback preparation insertion')

const oldStart = `  /** Starts sound at timeline second \`from\`; returns the context time that corresponds to it. */
  start(project: Project, from: number): number {
    const c = context()
    void c.resume()
    this.stopAll()
    rebuildGraph(project)
    const at = c.currentTime + 0.04
    running = { from, at, project }
    scheduleAll(project, from, at)
    return at
  },
`
const newStart = `  /** Prepares the first audible chunk, then starts sound and picture from one clock anchor. */
  async start(project: Project, from: number): Promise<number> {
    const c = context()

    // Stop the old timeline immediately. While the first chunk is prepared the
    // preview stays on the selected frame instead of silently running ahead.
    this.stopAll()
    const gen = generation
    const prepared = await preparePlaybackStart(project, from)
    if (gen !== generation) return c.currentTime

    await c.resume()
    if (gen !== generation) return c.currentTime

    rebuildGraph(project)
    const at = c.currentTime + 0.04
    running = { from, at, project }
    scheduleAll(project, from, at, prepared)
    return at
  },
`
audio = replaceOnce(audio, oldStart, newStart, 'audioEngine.start')

const oldScheduleHead = `function scheduleAll(project: Project, from: number, at: number) {`
const newScheduleHead = `function scheduleAll(project: Project, from: number, at: number, prepared?: PreparedPlaybackStart) {`
audio = replaceOnce(audio, oldScheduleHead, newScheduleHead, 'scheduleAll signature')

const oldScheduleBody = `    const asset = v.view.assets[v.clip.assetId!]
    if (isLongAudio(asset)) {
      streamers.push({ voice: v, asset, until: Math.max(from, start), busy: false })
      continue
    }
    const buffer = clipBufferNow(asset, v.clip)
    if (buffer) {
      const s = scheduleVoice(ctx, v, buffer, from, Infinity, at)
      if (s) active.push(s)
    } else void clipBuffer(asset, v.clip) // ready later → onAudioReady → refresh
`
const newScheduleBody = `    const asset = v.view.assets[v.clip.assetId!]
    const key = playbackVoiceKey(v.clip.id, v.offset)
    if (isLongAudio(asset)) {
      const first = prepared?.long.get(key)
      if (first) {
        const scheduled = scheduleVoice(ctx, v, first.buffer, first.from, first.to, at + (first.from - from), first.bufferStart)
        if (scheduled) active.push(scheduled)
        streamers.push({ voice: v, asset, until: first.to, busy: false })
      } else {
        streamers.push({ voice: v, asset, until: Math.max(from, start), busy: false })
      }
      continue
    }
    const buffer = prepared?.short.get(key) ?? clipBufferNow(asset, v.clip)
    if (buffer) {
      const s = scheduleVoice(ctx, v, buffer, from, Infinity, at)
      if (s) active.push(s)
    } else void clipBuffer(asset, v.clip) // ready later → onAudioReady → refresh
`
audio = replaceOnce(audio, oldScheduleBody, newScheduleBody, 'prepared schedule body')

// ---- Timeline.tsx ----
timeline = replaceOnce(
  timeline,
  "import { useUI, ZOOM_MAX, ZOOM_MIN, type Tool } from '@/editor/ui-store'\n",
  "import { useUI, type Tool } from '@/editor/ui-store'\n",
  'timeline UI import',
)
timeline = replaceOnce(
  timeline,
  "import { clamp } from '@/lib/math'\n",
  '',
  'timeline clamp import',
)
timeline = replaceOnce(
  timeline,
  "import { anchorNextZoom, useViewport } from './viewport'\n",
  "import { useViewport } from './viewport'\nimport { timelinePanDelta } from './wheel-nav'\n",
  'timeline viewport import',
)

const oldWheel = `    // Wheels and trackpads send several zoom events per frame: add them up and zoom once per frame.
    let zoomRaf = 0
    let wheel = 0
    let wheelX = 0
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      wheel += e.deltaY
      wheelX = e.clientX
      if (zoomRaf) return
      zoomRaf = requestAnimationFrame(() => {
        zoomRaf = 0
        const px = Math.max(0, wheelX - el.getBoundingClientRect().left - HEADER_W)
        const { pxPerSecond, setZoom } = useUI.getState()
        anchorNextZoom((useViewport.getState().scrollLeft + px) / pxPerSecond, px)
        setZoom(clamp(pxPerSecond * Math.exp(-wheel * 0.0025), ZOOM_MIN, ZOOM_MAX))
        wheel = 0
      })
    }
`
const newWheel = `    // Ctrl/Command + wheel is timeline navigation, not zoom.
    const onWheel = (e: WheelEvent) => {
      const pan = timelinePanDelta(e)
      if (pan === null) return
      e.preventDefault()
      el.scrollLeft += pan
    }
`
timeline = replaceOnce(timeline, oldWheel, newWheel, 'timeline Ctrl+wheel handler')

timeline = replaceOnce(
  timeline,
  `      cancelAnimationFrame(raf)
      cancelAnimationFrame(zoomRaf)
`,
  `      cancelAnimationFrame(raf)
`,
  'timeline wheel cleanup',
)

// Only after every transform succeeded do we back up and write.
for (const rel of [playbackPath, audioPath, timelinePath]) backup(rel)

write(playbackPath, playback)
write(audioPath, audio)
write(timelinePath, timeline)

// Copy helper modules/tests from the package.
const copies = [
  'src/editor/playback-start.ts',
  'src/editor/playback-start.test.ts',
  'src/engine/playback-sync.ts',
  'src/engine/playback-sync.test.ts',
  'src/features/timeline/wheel-nav.ts',
  'src/features/timeline/wheel-nav.test.ts',
]
for (const rel of copies) {
  const src = path.join(packageRoot, 'files', rel)
  const dst = path.join(repo, rel)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
}

console.log('Source changes applied successfully.')

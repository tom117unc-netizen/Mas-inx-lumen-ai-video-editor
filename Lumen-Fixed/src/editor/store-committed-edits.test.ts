import { beforeEach, describe, expect, it } from 'vitest'
import { createEmptyProject } from './new-project'
import {
  dispatch,
  getProject,
  rollbackTo,
  savepoint,
  subscribeCommittedEdits,
  useEditor,
  type CommittedEditEvent,
} from './store'

const events: CommittedEditEvent[] = []
let unsubscribe: (() => void) | undefined

function trackId(name: string) {
  return getProject().tracks.find(track => track.name === name)!.id
}

beforeEach(() => {
  unsubscribe?.()
  events.length = 0
  useEditor.getState().loadProject(createEmptyProject('Committed edits'))
  events.length = 0
  unsubscribe = subscribeCommittedEdits(event => events.push(event))
})

describe('committed editor events', () => {
  it('emits once for a successful undoable dispatch and never for rejected or background changes', () => {
    const added = dispatch('clip.add', { trackId: trackId('Titles'), kind: 'text', start: 0, duration: 30 })
    expect(added.ok).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'dispatch', source: 'user', revision: useEditor.getState().version })
    expect(events[0].historyId).toBeTypeOf('number')

    dispatch('clip.add', { trackId: trackId('Titles'), kind: 'text', start: -1, duration: 0 })
    expect(events).toHaveLength(1)

    const clipId = (added as { ok: true; result: string }).result
    dispatch('clip.update', { ids: [clipId], patch: { name: 'Derived rename' } }, { history: false })
    expect(events).toHaveLength(1)
  })

  it('emits one transaction event, not an event for each inner dispatch', () => {
    useEditor.getState().transaction('Build section', 'ai', () => {
      dispatch('marker.add', { frame: 10 })
      dispatch('marker.add', { frame: 20 })
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'transaction', label: 'Build section', source: 'ai' })
  })

  it('does not emit a transaction event when every change is rolled back', () => {
    useEditor.getState().transaction('Failed batch', 'ai', () => {
      const mark = savepoint()!
      dispatch('marker.add', { frame: 10 })
      rollbackTo(mark)
    })
    expect(events).toEqual([])
  })

  it('reuses the same history id for coalesced drag edits', () => {
    const added = dispatch('clip.add', { trackId: trackId('Titles'), kind: 'text', start: 0, duration: 30 })
    const clipId = (added as { ok: true; result: string }).result
    events.length = 0
    dispatch('clip.update', { ids: [clipId], patch: { transform: { x: 10 } } }, { coalesce: 'drag' })
    dispatch('clip.update', { ids: [clipId], patch: { transform: { x: 20 } } }, { coalesce: 'drag' })
    expect(events).toHaveLength(2)
    expect(events[0].historyId).toBe(events[1].historyId)
  })

  it('emits undo, redo and load with the resulting revision', () => {
    dispatch('marker.add', { frame: 5 })
    events.length = 0
    useEditor.getState().undo()
    useEditor.getState().redo()
    useEditor.getState().loadProject(createEmptyProject('Another project'))
    expect(events.map(event => event.kind)).toEqual(['undo', 'redo', 'load'])
    expect(events.map(event => event.revision)).toEqual([2, 3, 4])
  })

  it('reports direct AI marker commits through the same stream', () => {
    const result = useEditor.getState().applyAiMarkerChanges([{ op: 'add', id: 'ai-marker', frame: 30, label: 'AI boundary' }])
    expect(result.ok).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'dispatch', source: 'ai', label: 'AI marker edits' })
  })
})

/** Anime review AI tools: reliable IDs, nested timeline inventory and bounded project memory. */
import { getProject, useEditor } from '@/editor/store'
import { inspectTimelines, listTimelineMarkers } from '@/editor/anime-timeline-operations'
import { desktop } from '@/lib/platform'
import { flushContextBankWrites } from '@/project/context-bank-runtime'
import { useSession } from '@/project/session'
import { makeContextBankQuery } from './context-bank-query'
import { obj, str, num, int, oneOf, type AgentTool } from './kit'

export const ANIME_REVIEW_TOOLS: AgentTool[] = [
  {
    name: 'inspect_all_timelines',
    description: 'List the open and nested timelines with stable clip IDs, track IDs, start frames, durations and marker IDs. Does not switch timelines or change the project.',
    inputSchema: obj({}),
    run: async () => ({ timelines: inspectTimelines(getProject()) }),
  },
  {
    name: 'list_timeline_markers',
    description: 'List exact marker IDs, frames and labels on the open or a named nested timeline. Use these IDs for safe marker edits rather than guessing.',
    inputSchema: obj({ sequence_id: str('Optional nested timeline ID; omit for the open timeline.') }),
    run: async (args) => ({
      sequence_id: typeof args.sequence_id === 'string' ? args.sequence_id : getProject().sequence?.id ?? 'main',
      markers: listTimelineMarkers(getProject(), typeof args.sequence_id === 'string' ? args.sequence_id : undefined),
    }),
  },
  {
    name: 'edit_timeline_marker',
    description: 'Add, update or remove one marker by its stable ID on the open or nested timeline. Atomic, undoable and non-ripple: never moves clips. First call list_timeline_markers to identify the correct marker.',
    inputSchema: obj({
      operation: oneOf('Marker operation', ['add', 'update', 'remove']),
      id: str('Exact marker ID. For add, choose a unique new ID.'),
      sequence_id: str('Optional timeline ID; omit for open timeline.'),
      frame: num('Timeline frame. Required for add, optional for update; never seconds.'),
      label: str('Marker label. Required for add, optional for update.'),
      color: oneOf('Optional marker colour', ['lime', 'violet', 'pink', 'amber', 'emerald', 'sky']),
    }, ['operation', 'id']),
    run: async args => {
      const op = args.operation
      const id = args.id
      if (typeof id !== 'string' || !id.trim()) throw new Error('Marker ID required')
      const sequenceId = typeof args.sequence_id === 'string' ? args.sequence_id : undefined
      const frame = typeof args.frame === 'number' ? args.frame : undefined
      const label = typeof args.label === 'string' ? args.label : undefined
      const color = typeof args.color === 'string' ? args.color as 'lime' | 'violet' | 'pink' | 'amber' | 'emerald' | 'sky' : undefined
      if (op === 'add' && (frame === undefined || label === undefined)) throw new Error('Add requires frame and label')
      if (op !== 'add' && op !== 'update' && op !== 'remove') throw new Error('Unknown marker operation')
      const change = op === 'add'
        ? { op: 'add' as const, id, frame: frame!, label: label!, color, sequenceId }
        : op === 'remove'
          ? { op: 'remove' as const, id, sequenceId }
          : { op: 'update' as const, id, frame, label, color, sequenceId }
      const result = useEditor.getState().applyAiMarkerChanges([change])
      if (!result.ok) throw new Error(result.error)
      return { ok: true, ...result.result as object, undoable: true }
    },
  },
  {
    name: 'query_context_bank',
    description: 'Retrieve a compact, persistent slice of project context already learned by Lumen: current timeline clips/markers, source identities and recent committed edits. Use it before making or refining an edit decision instead of re-inspecting the whole project. Prefer a narrow timeline range. This reads cached context only; it does not analyse media.',
    inputSchema: obj({
      purpose: str('What decision this context is for, e.g. “refine the narration cut after this sentence”. Keep it specific.'),
      sequence_id: str('Optional exact timeline ID. Omit to query across timelines.'),
      start_frame: int('Optional inclusive start frame of the relevant timeline range.', { minimum: 0 }),
      end_frame: int('Optional exclusive end frame; must be after start_frame when both are supplied.', { minimum: 0 }),
      max_items: int('Optional result-item budget. Defaults to 80 and is hard-capped at 200.', { minimum: 1, maximum: 200 }),
      max_characters: int('Optional serialized context budget. Defaults to 12000 and is hard-capped at 28000.', { minimum: 500, maximum: 28000 }),
    }, ['purpose']),
    run: async args => {
      if (!desktop) throw new Error('The Context Bank needs the Lumen desktop app.')
      const request = makeContextBankQuery(args, useSession.getState().path, getProject().id)
      // A tool call can follow an edit immediately. Wait for the mutation stream so
      // the model never reads the bank one revision behind the canonical timeline.
      await flushContextBankWrites()
      return desktop.contextBank.query(request)
    },
  },
]

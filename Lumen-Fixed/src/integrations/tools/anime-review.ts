/** Anime review AI tools: reliable IDs and nested timeline inventory. */
import { getProject } from '@/editor/store'
import { inspectTimelines, listTimelineMarkers } from '@/editor/anime-timeline-operations'
import { obj, str, type AgentTool } from './kit'

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
]

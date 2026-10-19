import { resolveAgentVisualOutput } from './agent-vision'
import type { VisionSidecarPicture } from './vision-sidecar'

interface PrepareAgentToolVisualOutputArgs {
  toolText: string
  pictures: VisionSidecarPicture[]
  native: boolean
  vision: boolean
  analyse?: (toolText: string, pictures: VisionSidecarPicture[]) => Promise<string>
}

export type PreparedAgentToolVisualOutput = {
  text: string
  pictures: VisionSidecarPicture[]
  delivery: 'text' | 'follow' | 'native'
}

export async function prepareAgentToolVisualOutput(args: PrepareAgentToolVisualOutputArgs): Promise<PreparedAgentToolVisualOutput> {
  const resolved = await resolveAgentVisualOutput(args)
  if (resolved.kind === 'text') return { text: resolved.text, pictures: [], delivery: 'text' }
  return { text: resolved.text, pictures: args.pictures, delivery: resolved.kind }
}

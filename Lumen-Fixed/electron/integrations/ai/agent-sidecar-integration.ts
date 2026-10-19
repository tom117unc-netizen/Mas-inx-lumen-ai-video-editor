import { resolveAgentVisualOutput } from './agent-vision'
import type { VisionSidecarPicture } from './vision-sidecar'

export type AgentVisualAnalyser = (toolText: string, pictures: VisionSidecarPicture[]) => Promise<string>
export type AgentVisualAnalyserFactory = () => Promise<AgentVisualAnalyser | undefined>

interface PrepareAgentToolVisualOutputArgs {
  toolText: string
  pictures: VisionSidecarPicture[]
  native: boolean
  vision: boolean
  analyse?: AgentVisualAnalyser
  getAnalyse?: AgentVisualAnalyserFactory
}

export type PreparedAgentToolVisualOutput = {
  text: string
  pictures: VisionSidecarPicture[]
  delivery: 'text' | 'follow' | 'native'
}

export async function prepareAgentToolVisualOutput(args: PrepareAgentToolVisualOutputArgs): Promise<PreparedAgentToolVisualOutput> {
  let analyse = args.analyse
  if (!analyse && !args.native && !args.vision && args.pictures.length && args.getAnalyse) {
    analyse = await args.getAnalyse()
  }

  const resolved = await resolveAgentVisualOutput({
    toolText: args.toolText,
    pictures: args.pictures,
    native: args.native,
    vision: args.vision,
    analyse,
  })
  if (resolved.kind === 'text') return { text: resolved.text, pictures: [], delivery: 'text' }
  return { text: resolved.text, pictures: args.pictures, delivery: resolved.kind }
}

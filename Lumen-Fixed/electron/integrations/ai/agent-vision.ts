import { visionFailureToolText, type VisionSidecarPicture } from './vision-sidecar'

interface ResolveAgentVisualOutputArgs {
  toolText: string
  pictures: VisionSidecarPicture[]
  native: boolean
  vision: boolean
  analyse?: (toolText: string, pictures: VisionSidecarPicture[]) => Promise<string>
}

type AgentVisualOutput =
  | { kind: 'text'; text: string }
  | { kind: 'follow'; text: string }
  | { kind: 'native'; text: string }

export async function resolveAgentVisualOutput(args: ResolveAgentVisualOutputArgs): Promise<AgentVisualOutput> {
  if (args.native && args.vision) return { kind: 'native', text: args.toolText }
  if (args.vision) return { kind: 'follow', text: args.toolText }

  if (!args.pictures.length) return { kind: 'text', text: args.toolText }

  if (!args.analyse) {
    return {
      kind: 'text',
      text: visionFailureToolText(args.toolText, 'No vision-capable sidecar is available.'),
    }
  }

  return { kind: 'text', text: await args.analyse(args.toolText, args.pictures) }
}

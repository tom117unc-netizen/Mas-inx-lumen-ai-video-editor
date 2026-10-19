export interface VisionSidecarFrame {
  timestamp: string
  description: string
  editUse?: string
}

export interface VisionSidecarObservation {
  summary: string
  frames: VisionSidecarFrame[]
  uncertainty?: string[]
}

/**
 * Preserve the editor tool's authoritative timing/clip metadata, then append
 * compact visual evidence produced by a vision-capable sidecar. The reasoning
 * model can use this as evidence, but should never treat uncertain visual
 * details as verified source timestamps beyond those supplied by the tool.
 */
export function sidecarToolText(toolText: string, observation: VisionSidecarObservation) {
  const frames = observation.frames
    .map((frame) => `- ${frame.timestamp}: ${frame.description}${frame.editUse ? `\n  Edit use: ${frame.editUse}` : ''}`)
    .join('\n')
  const uncertainty = observation.uncertainty?.length
    ? `\n\nUNCERTAINTY — do not guess:\n${observation.uncertainty.map((item) => `- ${item}`).join('\n')}`
    : ''

  return `${toolText}\n\nVISUAL EVIDENCE FROM VISION SIDECAR:\n${observation.summary}\n\nTIMESTAMPED FRAMES:\n${frames || '- No reliable frame observations returned.'}${uncertainty}`
}

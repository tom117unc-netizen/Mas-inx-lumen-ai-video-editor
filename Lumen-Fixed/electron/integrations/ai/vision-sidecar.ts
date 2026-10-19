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
 * Parse deliberately strict evidence. A malformed/empty answer is a failed
 * visual inspection, not permission for the reasoning model to fill gaps.
 */
export function parseVisionSidecarObservation(raw: string): VisionSidecarObservation {
  const source = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch {
    throw new Error('Vision sidecar returned invalid JSON; visual inspection failed.')
  }
  const candidate = value as Partial<VisionSidecarObservation>
  if (typeof candidate.summary !== 'string' || !candidate.summary.trim()) throw new Error('Vision sidecar returned no reliable summary.')
  if (!Array.isArray(candidate.frames) || !candidate.frames.length) throw new Error('Vision sidecar returned no frame observations.')
  for (const frame of candidate.frames) {
    if (!frame || typeof frame.timestamp !== 'string' || !frame.timestamp.trim() || typeof frame.description !== 'string' || !frame.description.trim()) {
      throw new Error('Vision sidecar returned an incomplete frame observation.')
    }
  }
  return {
    summary: candidate.summary.trim(),
    frames: candidate.frames.map((frame) => ({ timestamp: frame.timestamp.trim(), description: frame.description.trim(), ...(frame.editUse?.trim() ? { editUse: frame.editUse.trim() } : {}) })),
    uncertainty: Array.isArray(candidate.uncertainty) ? candidate.uncertainty.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [],
  }
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

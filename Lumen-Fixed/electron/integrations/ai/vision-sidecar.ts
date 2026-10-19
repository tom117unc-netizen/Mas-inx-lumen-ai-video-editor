import type { ModelMessage } from 'ai'
import type { ModelInfo } from '../../../shared/ai'

export interface VisionSidecarPicture { data: string; mimeType: string }
export interface VisionSidecarFrame { timestamp: string; description: string; editUse?: string }
export interface VisionSidecarObservation { summary: string; frames: VisionSidecarFrame[]; uncertainty?: string[] }
export const shouldUseVisionSidecar = (nativeVision: boolean, pictureCount: number) => !nativeVision && pictureCount > 0

export function selectVisionSidecar(models: ModelInfo[], preferredId?: string) {
  const vision = models.filter((model) => model.vision === true)
  if (!vision.length) return undefined
  if (preferredId) { const preferred = vision.find((model) => model.id === preferredId); if (preferred) return preferred }
  return [...vision].sort((a, b) => (b.context ?? 0) - (a.context ?? 0))[0]
}

export function buildVisionSidecarPrompt(toolText: string, pictureCount: number) {
  return `You are the visual-analysis sidecar for a professional video editor. Inspect all ${pictureCount} images in order. The editor tool metadata below is authoritative for timing and image order; never invent timestamps or claim metadata that is not present.\n\nTOOL METADATA:\n${toolText}\n\nReturn JSON only with this exact shape:\n{"summary":"...","frames":[{"timestamp":"timestamp/cell label from metadata","description":"...","editUse":"..."}],"uncertainty":["..."]}\n\nFor every usable image, make description/editUse detailed enough for another model to edit without seeing it. Include where visible: characters/subjects and actions/expressions; shot size and camera angle/movement cues; composition and screen position; readable subtitles/on-screen text; overlays/PNGTuber and occlusion; lighting/clarity; continuity with adjacent frames; useful cut/reaction/transition points; and concrete crop, zoom, reframe, blur or cutaway options. If potentially sensitive imagery appears, describe only what is necessary to edit it safely and identify the sensitive region plus usable crop/reframe/blur/cutaway options. Do not avoid relevant footage merely because it needs reframing. Put anything unreadable, ambiguous, inferred, or uncertain in uncertainty instead of guessing. Preserve image order and anchor each frame to the closest timestamp/cell label supplied by the tool.`
}

export function visionSidecarMessages(toolText: string, pictures: VisionSidecarPicture[]): ModelMessage[] {
  return [{ role: 'user', content: [{ type: 'text', text: buildVisionSidecarPrompt(toolText, pictures.length) }, ...pictures.map((picture) => ({ type: 'image' as const, image: picture.data, mediaType: picture.mimeType }))] }]
}

export function parseVisionSidecarObservation(raw: string): VisionSidecarObservation {
  const source = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let value: unknown
  try { value = JSON.parse(source) } catch { throw new Error('Vision sidecar returned invalid JSON; visual inspection failed.') }
  const candidate = value as Partial<VisionSidecarObservation>
  if (typeof candidate.summary !== 'string' || !candidate.summary.trim()) throw new Error('Vision sidecar returned no reliable summary.')
  if (!Array.isArray(candidate.frames) || !candidate.frames.length) throw new Error('Vision sidecar returned no frame observations.')
  for (const frame of candidate.frames) if (!frame || typeof frame.timestamp !== 'string' || !frame.timestamp.trim() || typeof frame.description !== 'string' || !frame.description.trim()) throw new Error('Vision sidecar returned an incomplete frame observation.')
  return { summary: candidate.summary.trim(), frames: candidate.frames.map((frame) => ({ timestamp: frame.timestamp.trim(), description: frame.description.trim(), ...(frame.editUse?.trim() ? { editUse: frame.editUse.trim() } : {}) })), uncertainty: Array.isArray(candidate.uncertainty) ? candidate.uncertainty.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()) : [] }
}

export function sidecarToolText(toolText: string, observation: VisionSidecarObservation) {
  const frames = observation.frames.map((frame) => `- ${frame.timestamp}: ${frame.description}${frame.editUse ? `\n  Edit use: ${frame.editUse}` : ''}`).join('\n')
  const uncertainty = observation.uncertainty?.length ? `\n\nUNCERTAINTY — do not guess:\n${observation.uncertainty.map((item) => `- ${item}`).join('\n')}` : ''
  return `${toolText}\n\nVISUAL EVIDENCE FROM VISION SIDECAR:\n${observation.summary}\n\nTIMESTAMPED FRAMES:\n${frames || '- No reliable frame observations returned.'}${uncertainty}`
}

export function visionFailureToolText(toolText: string, reason: string) {
  return `${toolText}\n\nVISUAL INSPECTION FAILED: ${reason}\nDo not infer visual facts, composition, subjects, actions, readable text, or suitability from the timeline/tool metadata alone. Use another visual inspection route or report that visual evidence is unavailable.`
}

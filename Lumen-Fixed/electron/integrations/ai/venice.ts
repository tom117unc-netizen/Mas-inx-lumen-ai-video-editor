import type { ModelInfo, ProviderId } from '../../../shared/ai'

interface VeniceCapabilities {
  supportsFunctionCalling?: boolean
  supportsVision?: boolean
  supportsMultipleImages?: boolean
  supportsReasoning?: boolean
}

interface VeniceModel {
  id?: string
  name?: string
  model_spec?: {
    availableContextTokens?: number
    contextTokens?: number
    capabilities?: VeniceCapabilities
  }
}

export function veniceBaseURL(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'api.venice.ai') return undefined
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
  } catch {
    return undefined
  }
}

export function parseVeniceModels(json: unknown): ModelInfo[] {
  const data = (json as { data?: VeniceModel[] } | undefined)?.data ?? []
  return data.flatMap((entry) => {
    if (!entry.id) return []
    const caps = entry.model_spec?.capabilities
    if (caps?.supportsFunctionCalling === false) return []
    return [{
      id: entry.id,
      name: entry.name ?? entry.id,
      context: entry.model_spec?.availableContextTokens ?? entry.model_spec?.contextTokens,
      vision: caps?.supportsVision,
    } satisfies ModelInfo]
  })
}

export function parseVeniceVisionTrait(json: unknown): string | undefined {
  const data = (json as { data?: Record<string, unknown> } | undefined)?.data
  const value = data?.default_vision ?? data?.['text:default_vision']
  return typeof value === 'string' && value ? value : undefined
}

export function shouldUseVeniceVisionSidecar(provider: ProviderId, url: string, canSee: boolean | undefined) {
  return provider === 'custom' && canSee === false && Boolean(veniceBaseURL(url))
}

/**
 * The sidecar is the editor's eyes, not a chat captioner. Its result is fed to
 * the main editing agent, so preserve concrete visual facts that can drive an edit.
 */
export function visionInspectionPrompt(toolContext: string, pictureCount: number) {
  return `You are the visual inspection sidecar for Lumen, a professional video editor. Analyse the ${pictureCount} images returned by an editor inspection tool (${toolContext}).

Return dense, factual, edit-grade observations. Do not give a generic summary and do not invent anything that is not visible.

For a contact sheet, work frame-by-frame in image order. For every image include its visible timestamp/label when present and describe:
- characters/subjects: identity when visually supportable, expression, pose, gaze, action and interaction;
- shot and composition: shot size, framing, subject position, foreground/background, camera angle/movement cues, focus and important empty space;
- visible text: titles, captions, subtitles, credits, UI and signs; transcribe short readable text exactly when practical;
- editing layers: PNGTuber/avatar, overlays, graphics, lower thirds, borders, subtitles and any overlap or occlusion;
- image qualities relevant to editing: lighting, colour/contrast, clarity, continuity with adjacent frames and obvious visual changes/cuts;
- sensitive or unsuitable imagery only as needed for editing: neutrally identify the relevant region/content and say whether crop, reframe, shortened excerpt, cutaway or blur would preserve the editorial point. Do not omit a useful observation merely because the material is sensitive;
- editing implications: specific problems or opportunities such as obstructed subjects, dead space, repetitive framing, bad crop, unreadable text, weak evidence, continuity mismatch, or a strong reaction/evidence frame.

Distinguish observation from inference. Mark uncertain identities/actions as uncertain. If an image is unreadable, blank, duplicated or ambiguous, say so rather than guessing.

Finish with a compact cross-frame continuity summary highlighting cuts, progression, repeated frames, and the most useful frames for editing.`
}

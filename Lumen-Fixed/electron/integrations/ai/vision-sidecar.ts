interface VisionPromptInput {
  pictureCount: number
  toolText: string
}

export function buildVisionSidecarPrompt({ pictureCount, toolText }: VisionPromptInput) {
  return `You are the visual-analysis sidecar for a professional video editor. Analyse all ${pictureCount} supplied image${pictureCount === 1 ? '' : 's'} as edit evidence, not as generic captions.

Tool context:\n${toolText}

Return a compact but highly detailed observation that another AI editor can safely act on without seeing the pixels itself. For every distinguishable frame/cell, preserve any visible timestamp or infer its ordering from the contact sheet and report:
- timestamp/frame position and continuity with neighbouring frames;
- subjects/characters, visible actions, expressions and interactions;
- shot type/size, camera angle/movement cues, composition, screen position, eyeline and important foreground/background elements;
- readable text, subtitles, title cards, credits and UI, including approximate screen position;
- overlays, PNGTuber/avatar elements, masks, graphics and any occlusion of important content;
- image clarity, lighting, focus and whether the frame is actually useful as evidence;
- sensitive or unsuitable visual regions when relevant to editing, described neutrally, plus practical safe crop, zoom, reframe, cutaway or blur options that preserve the editorial meaning;
- concrete editing implications: what the shot can establish/prove, useful cut points, continuity risks, and what should not be inferred;
- uncertainty explicitly. Never invent identities, dialogue, events or details that are not visually supported.

Function over brevity: include enough spatial and temporal detail for an editing agent to make effective source-selection, crop/reframe, overlay-placement and pacing decisions. Avoid filler and do not make timeline changes.`
}

export function formatVisionObservation(toolText: string, observation: string) {
  return `${toolText}\n\n--- VISION SIDECAR OBSERVATION (pixel-derived visual evidence) ---\n${observation.trim()}`
}

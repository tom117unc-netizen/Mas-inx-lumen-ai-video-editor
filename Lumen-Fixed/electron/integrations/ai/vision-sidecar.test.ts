import { describe, expect, it } from 'vitest'
import { buildVisionSidecarPrompt, parseVisionSidecarObservation, selectVisionSidecar, shouldUseVisionSidecar, sidecarToolText, visionFailureToolText, visionSidecarMessages } from './vision-sidecar'

describe('vision sidecar evidence', () => {
  it('replaces unavailable pictures with detailed timestamp-preserving visual evidence', () => {
    const text = sidecarToolText('Contact sheet 00:00–01:00; cells every 5s.', { summary: 'Bedroom conversation with a cut to a title card.', frames: [{ timestamp: '00:15', description: 'Medium shot of Mitsuki, screen-left.', editUse: 'Clean reaction cut; crop right side safely.' }, { timestamp: '00:45', description: 'Chapter card with YUYA text.', editUse: 'Use as chapter transition.' }], uncertainty: ['00:15 subtitle wording is too small to read confidently.'] })
    expect(text).toContain('VISUAL EVIDENCE FROM VISION SIDECAR'); expect(text).toContain('00:15'); expect(text).toContain('crop right side safely'); expect(text).toContain('UNCERTAINTY')
  })
  it('parses fenced JSON returned by a vision model and rejects incomplete evidence', () => {
    const parsed = parseVisionSidecarObservation('```json\n{"summary":"Two-shot in bedroom.","frames":[{"timestamp":"00:10","description":"Mitsuki left, Yuya right.","editUse":"Safe two-shot."}],"uncertainty":[]}\n```')
    expect(parsed.frames[0].timestamp).toBe('00:10'); expect(() => parseVisionSidecarObservation('{"summary":"x","frames":[]}')).toThrow(/frame observation/i)
  })
  it('asks for edit-grade evidence and anchors image order to tool timestamps', () => {
    const prompt = buildVisionSidecarPrompt('Contact sheet 00:00–00:20. Cell 1 00:00, Cell 2 00:05, Cell 3 00:10, Cell 4 00:15.', 4)
    expect(prompt).toContain('4 images'); expect(prompt).toContain('00:05'); expect(prompt).toContain('shot size'); expect(prompt).toContain('crop'); expect(prompt).toContain('sensitive'); expect(prompt).toContain('uncertainty')
  })
  it('builds a multimodal message containing every returned picture', () => {
    const messages = visionSidecarMessages('Cell 1 00:00; Cell 2 00:05.', [{ data: 'AAA', mimeType: 'image/png' }, { data: 'BBB', mimeType: 'image/jpeg' }])
    expect(messages).toHaveLength(1); expect(Array.isArray(messages[0].content)).toBe(true); expect(messages[0].content).toHaveLength(3)
    expect(messages[0].content[1]).toMatchObject({ type: 'image', image: 'AAA', mediaType: 'image/png' }); expect(messages[0].content[2]).toMatchObject({ type: 'image', image: 'BBB', mediaType: 'image/jpeg' })
  })
  it('prefers the provider default vision trait and otherwise chooses a vision model', () => {
    const models = [{ id: 'deepseek-v3-2', name: 'DeepSeek', vision: false }, { id: 'vision-a', name: 'Vision A', vision: true, context: 128000 }, { id: 'vision-b', name: 'Vision B', vision: true, context: 1000000 }]
    expect(selectVisionSidecar(models, 'vision-a')?.id).toBe('vision-a'); expect(selectVisionSidecar(models, 'missing')?.id).toBe('vision-b')
  })
  it('uses the sidecar only for pictures sent to a model without native vision', () => { expect(shouldUseVisionSidecar(false, 12)).toBe(true); expect(shouldUseVisionSidecar(true, 12)).toBe(false); expect(shouldUseVisionSidecar(false, 0)).toBe(false) })
  it('makes visual failure explicit instead of inviting metadata-based guessing', () => { const text = visionFailureToolText('Contact sheet metadata.', 'No configured vision-capable model.'); expect(text).toContain('VISUAL INSPECTION FAILED'); expect(text).toContain('Do not infer visual facts') })
})

import { describe, expect, it } from 'vitest'
import { buildVisionSidecarPrompt, parseVisionSidecarObservation, selectVisionSidecar, sidecarToolText } from './vision-sidecar'

describe('vision sidecar evidence', () => {
  it('replaces unavailable pictures with detailed timestamp-preserving visual evidence', () => {
    const text = sidecarToolText('Contact sheet 00:00–01:00; cells every 5s.', {
      summary: 'Bedroom conversation with a cut to a title card.',
      frames: [
        { timestamp: '00:15', description: 'Medium shot of Mitsuki, screen-left.', editUse: 'Clean reaction cut; crop right side safely.' },
        { timestamp: '00:45', description: 'Chapter card with YUYA text.', editUse: 'Use as chapter transition.' },
      ],
      uncertainty: ['00:15 subtitle wording is too small to read confidently.'],
    })

    expect(text).toContain('VISUAL EVIDENCE FROM VISION SIDECAR')
    expect(text).toContain('00:15')
    expect(text).toContain('Medium shot of Mitsuki')
    expect(text).toContain('crop right side safely')
    expect(text).toContain('00:45')
    expect(text).toContain('UNCERTAINTY')
    expect(text).not.toContain('picture not shown')
  })

  it('parses fenced JSON returned by a vision model and rejects incomplete evidence', () => {
    const parsed = parseVisionSidecarObservation('```json\n{"summary":"Two-shot in bedroom.","frames":[{"timestamp":"00:10","description":"Mitsuki left, Yuya right.","editUse":"Safe two-shot."}],"uncertainty":[]}\n```')
    expect(parsed.frames[0].timestamp).toBe('00:10')
    expect(() => parseVisionSidecarObservation('{"summary":"x","frames":[]}')).toThrow(/frame observation/i)
  })

  it('asks for edit-grade evidence and anchors image order to tool timestamps', () => {
    const prompt = buildVisionSidecarPrompt('Contact sheet 00:00–00:20. Cell 1 00:00, Cell 2 00:05, Cell 3 00:10, Cell 4 00:15.', 4)
    expect(prompt).toContain('4 images')
    expect(prompt).toContain('00:05')
    expect(prompt).toContain('shot size')
    expect(prompt).toContain('crop')
    expect(prompt).toContain('sensitive')
    expect(prompt).toContain('uncertainty')
    expect(prompt).toContain('JSON')
  })

  it('prefers the provider default vision trait and otherwise chooses a vision model', () => {
    const models = [
      { id: 'deepseek-v3-2', name: 'DeepSeek', vision: false },
      { id: 'vision-a', name: 'Vision A', vision: true, context: 128000 },
      { id: 'vision-b', name: 'Vision B', vision: true, context: 1000000 },
    ]
    expect(selectVisionSidecar(models, 'vision-a')?.id).toBe('vision-a')
    expect(selectVisionSidecar(models, 'missing')?.id).toBe('vision-b')
  })
})

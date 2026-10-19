import { describe, expect, it } from 'vitest'
import { sidecarToolText } from './vision-sidecar'

describe('sidecarToolText', () => {
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
})

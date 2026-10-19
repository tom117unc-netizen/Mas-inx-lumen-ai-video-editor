import { describe, expect, it } from 'vitest'
import { buildVisionSidecarPrompt, formatVisionObservation } from './vision-sidecar'

describe('vision sidecar', () => {
  it('asks for edit-grade visual evidence instead of a generic caption', () => {
    const prompt = buildVisionSidecarPrompt({ pictureCount: 12, toolText: 'Contact sheet 00:00–01:00, 5 second intervals.' })
    expect(prompt).toContain('timestamp')
    expect(prompt).toContain('shot')
    expect(prompt).toContain('composition')
    expect(prompt).toContain('readable text')
    expect(prompt).toContain('occlusion')
    expect(prompt).toContain('crop')
    expect(prompt).toContain('blur')
    expect(prompt).toContain('uncertainty')
    expect(prompt).toContain('editing')
    expect(prompt).toContain('12')
  })

  it('labels sidecar output as visual evidence and preserves the original tool metadata', () => {
    const text = formatVisionObservation('Contact sheet metadata', '00:05: medium shot; subject frame-left; subtitle bottom-centre.')
    expect(text).toContain('Contact sheet metadata')
    expect(text).toContain('VISION SIDECAR OBSERVATION')
    expect(text).toContain('00:05')
  })
})

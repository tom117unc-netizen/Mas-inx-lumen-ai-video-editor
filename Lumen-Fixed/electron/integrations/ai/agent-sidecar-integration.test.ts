import { describe, expect, it, vi } from 'vitest'
import { prepareAgentToolVisualOutput } from './agent-sidecar-integration'

const pictures = [
  { data: 'frame-a', mimeType: 'image/png' },
  { data: 'frame-b', mimeType: 'image/png' },
]

describe('agent sidecar integration', () => {
  it('replaces inaccessible pictures with sidecar evidence before a text-only agent sees the tool result', async () => {
    const analyse = vi.fn(async () => 'metadata\n\nVISUAL EVIDENCE FROM VISION SIDECAR:\n00:05 Mitsuki turns toward camera.')
    const out = await prepareAgentToolVisualOutput({
      toolText: 'Contact sheet cells: 00:00, 00:05',
      pictures,
      native: false,
      vision: false,
      analyse,
    })

    expect(analyse).toHaveBeenCalledWith('Contact sheet cells: 00:00, 00:05', pictures)
    expect(out).toEqual({
      text: expect.stringContaining('VISUAL EVIDENCE FROM VISION SIDECAR'),
      pictures: [],
      delivery: 'text',
    })
  })

  it('keeps pictures on the existing path for a vision-capable agent', async () => {
    const analyse = vi.fn()
    const out = await prepareAgentToolVisualOutput({
      toolText: 'Contact sheet',
      pictures,
      native: false,
      vision: true,
      analyse,
    })

    expect(analyse).not.toHaveBeenCalled()
    expect(out).toEqual({ text: 'Contact sheet', pictures, delivery: 'follow' })
  })
})

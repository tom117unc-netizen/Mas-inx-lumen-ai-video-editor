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

  it('resolves a sidecar lazily only when a text-only agent actually receives pictures', async () => {
    const analyse = vi.fn(async () => 'metadata\n\nVISUAL EVIDENCE FROM VISION SIDECAR:\n00:05 useful reaction shot.')
    const getAnalyse = vi.fn(async () => analyse)

    const textOnly = await prepareAgentToolVisualOutput({
      toolText: 'Contact sheet cells: 00:00, 00:05',
      pictures,
      native: false,
      vision: false,
      getAnalyse,
    } as Parameters<typeof prepareAgentToolVisualOutput>[0] & { getAnalyse: typeof getAnalyse })

    expect(getAnalyse).toHaveBeenCalledTimes(1)
    expect(analyse).toHaveBeenCalledWith('Contact sheet cells: 00:00, 00:05', pictures)
    expect(textOnly.text).toContain('VISUAL EVIDENCE FROM VISION SIDECAR')
    expect(textOnly.pictures).toEqual([])

    getAnalyse.mockClear()
    analyse.mockClear()
    const visionModel = await prepareAgentToolVisualOutput({
      toolText: 'Contact sheet',
      pictures,
      native: false,
      vision: true,
      getAnalyse,
    } as Parameters<typeof prepareAgentToolVisualOutput>[0] & { getAnalyse: typeof getAnalyse })

    expect(getAnalyse).not.toHaveBeenCalled()
    expect(analyse).not.toHaveBeenCalled()
    expect(visionModel).toEqual({ text: 'Contact sheet', pictures, delivery: 'follow' })
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

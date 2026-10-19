import { describe, expect, it, vi } from 'vitest'
import { resolveAgentVisualOutput } from './agent-vision'

describe('agent visual routing', () => {
  const pictures = [{ data: 'AAA', mimeType: 'image/png' }]

  it('routes pictures through the sidecar for a known text-only reasoning model', async () => {
    const analyse = vi.fn(async () => 'metadata\n\nVISUAL EVIDENCE FROM VISION SIDECAR:\n00:00 wide bedroom shot')
    const out = await resolveAgentVisualOutput({ toolText: 'metadata', pictures, native: false, vision: false, analyse })
    expect(analyse).toHaveBeenCalledWith('metadata', pictures)
    expect(out).toEqual({ kind: 'text', text: expect.stringContaining('VISUAL EVIDENCE FROM VISION SIDECAR') })
  })

  it('does not invoke the sidecar when the reasoning model can see images', async () => {
    const analyse = vi.fn(async () => 'should not run')
    const compatible = await resolveAgentVisualOutput({ toolText: 'metadata', pictures, native: false, vision: true, analyse })
    expect(compatible).toEqual({ kind: 'follow', text: 'metadata' })
    const native = await resolveAgentVisualOutput({ toolText: 'metadata', pictures, native: true, vision: true, analyse })
    expect(native).toEqual({ kind: 'native', text: 'metadata' })
    expect(analyse).not.toHaveBeenCalled()
  })

  it('returns explicit visual failure evidence when no sidecar is available', async () => {
    const out = await resolveAgentVisualOutput({ toolText: 'metadata', pictures, native: false, vision: false })
    expect(out.kind).toBe('text')
    expect(out.text).toContain('VISUAL INSPECTION FAILED')
    expect(out.text).toContain('Do not infer visual facts')
  })
})

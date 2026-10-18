import { describe, expect, it, vi } from 'vitest'
import { SourceReaderPool } from './source-reader-pool'

describe('SourceReaderPool', () => {
  it('reuses one reader across successive cuts from the same source', () => {
    const create = vi.fn((url: string) => ({ url, dispose: vi.fn() }))
    const pool = new SourceReaderPool(create)

    const firstCut = pool.get('recording.mp4', 0)
    const laterCut = pool.get('recording.mp4', 0)

    expect(laterCut).toBe(firstCut)
    expect(create).toHaveBeenCalledTimes(1)
    expect(pool.count('recording.mp4')).toBe(1)
  })

  it('adds another reader only when the same source is needed simultaneously', () => {
    const create = vi.fn((url: string) => ({ url, dispose: vi.fn() }))
    const pool = new SourceReaderPool(create)

    const first = pool.get('recording.mp4', 0)
    const second = pool.get('recording.mp4', 1)

    expect(second).not.toBe(first)
    expect(create).toHaveBeenCalledTimes(2)

    expect(pool.get('recording.mp4', 0)).toBe(first)
    expect(pool.get('recording.mp4', 1)).toBe(second)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('disposes every pooled reader', () => {
    const readers: Array<{ url: string; dispose: ReturnType<typeof vi.fn> }> = []
    const pool = new SourceReaderPool((url) => {
      const reader = { url, dispose: vi.fn() }
      readers.push(reader)
      return reader
    })

    pool.get('a.mp4', 0)
    pool.get('b.mp4', 0)
    pool.get('b.mp4', 1)
    pool.dispose()

    expect(readers.every((reader) => reader.dispose.mock.calls.length === 1)).toBe(true)
    expect(pool.count()).toBe(0)
  })
})

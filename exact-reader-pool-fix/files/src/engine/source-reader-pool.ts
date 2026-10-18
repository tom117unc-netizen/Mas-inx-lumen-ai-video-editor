/**
 * A small pool keyed by media source rather than timeline clip.
 *
 * Large MP4 recordings can have expensive sample tables. Reopening the same
 * source for every cut makes the decoder/parser rebuild those structures over
 * and over. Pooling by source keeps the common cuts-only case at one reader
 * while still allowing multiple simultaneous readers for transitions/overlays.
 */
export class SourceReaderPool<T extends { dispose(): void }> {
  private readonly readers = new Map<string, T[]>()

  constructor(private readonly create: (url: string) => T) {}

  get(url: string, slot = 0) {
    let pool = this.readers.get(url)
    if (!pool) {
      pool = []
      this.readers.set(url, pool)
    }
    while (pool.length <= slot) pool.push(this.create(url))
    return pool[slot]
  }

  count(url?: string) {
    if (url !== undefined) return this.readers.get(url)?.length ?? 0
    let total = 0
    for (const pool of this.readers.values()) total += pool.length
    return total
  }

  dispose() {
    for (const pool of this.readers.values()) {
      for (const reader of pool) reader.dispose()
    }
    this.readers.clear()
  }
}

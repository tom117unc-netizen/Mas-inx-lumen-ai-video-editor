import fs from 'node:fs'
import { createHash } from 'node:crypto'

const SAMPLE_BYTES = 1024 * 1024
const FULL_READ_LIMIT = SAMPLE_BYTES * 2

export interface SourceFingerprint {
  fingerprint: string
  size: number
  mtime: number
}

/**
 * Stable media identity without reading an entire episode into memory.
 * Small files are hashed fully; larger files hash size + 1 MiB head + 1 MiB tail.
 */
export function fingerprintSourceFile(file: string): SourceFingerprint {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile()) throw new Error('not a file')
    const hash = createHash('sha256')
    hash.update('lumen-source-v1\0')
    hash.update(String(stat.size))
    hash.update('\0')
    if (stat.size <= FULL_READ_LIMIT) {
      hash.update(fs.readFileSync(file))
    } else {
      const fd = fs.openSync(file, 'r')
      try {
        const head = Buffer.allocUnsafe(SAMPLE_BYTES)
        const tail = Buffer.allocUnsafe(SAMPLE_BYTES)
        const headRead = fs.readSync(fd, head, 0, SAMPLE_BYTES, 0)
        const tailRead = fs.readSync(fd, tail, 0, SAMPLE_BYTES, stat.size - SAMPLE_BYTES)
        hash.update(head.subarray(0, headRead))
        hash.update(tail.subarray(0, tailRead))
      } finally {
        fs.closeSync(fd)
      }
    }
    return { fingerprint: hash.digest('hex'), size: stat.size, mtime: Math.round(stat.mtimeMs) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not fingerprint source file: ${detail}`)
  }
}

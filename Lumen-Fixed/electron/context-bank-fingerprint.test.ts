import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fingerprintSourceFile } from './context-bank-fingerprint'

const roots: string[] = []
function tempFile(name: string, data: Uint8Array | string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-fingerprint-'))
  roots.push(root)
  const file = path.join(root, name)
  fs.writeFileSync(file, data)
  return file
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('fingerprintSourceFile', () => {
  it('is deterministic and includes file contents and size', () => {
    const file = tempFile('episode.bin', Buffer.from('opening-scene'))
    const first = fingerprintSourceFile(file)
    const second = fingerprintSourceFile(file)
    expect(second.fingerprint).toBe(first.fingerprint)
    expect(second.size).toBe(Buffer.byteLength('opening-scene'))

    fs.writeFileSync(file, Buffer.from('different-data'))
    const changed = fingerprintSourceFile(file)
    expect(changed.fingerprint).not.toBe(first.fingerprint)

    fs.appendFileSync(file, Buffer.from('!'))
    const resized = fingerprintSourceFile(file)
    expect(resized.size).toBe(changed.size + 1)
    expect(resized.fingerprint).not.toBe(changed.fingerprint)
  })

  it('reads at most 1 MiB from each end of a large source', () => {
    const size = 3 * 1024 * 1024 + 123
    const file = tempFile('large-episode.mkv', Buffer.alloc(size, 7))
    const read = vi.spyOn(fs, 'readSync')
    const readWhole = vi.spyOn(fs, 'readFileSync')

    const result = fingerprintSourceFile(file)
    expect(result.size).toBe(size)
    expect(readWhole).not.toHaveBeenCalled()
    const requested = read.mock.calls.reduce((sum, call) => sum + Number(call[3] ?? 0), 0)
    expect(requested).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(read.mock.calls.length).toBeLessThanOrEqual(2)
  })

  it('fails in a controlled way for missing files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-fingerprint-missing-'))
    roots.push(root)
    expect(() => fingerprintSourceFile(path.join(root, 'gone.mkv'))).toThrow(/could not fingerprint source file/i)
  })
})

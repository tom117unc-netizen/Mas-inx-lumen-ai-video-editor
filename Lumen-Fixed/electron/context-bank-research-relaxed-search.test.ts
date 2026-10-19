import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ContextBankResearchSeedWriteRequest } from '../shared/context-bank-research'
import { openContextBank } from './context-bank'

const roots: string[] = []

function projectFile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-context-research-relaxed-'))
  roots.push(root)
  const dir = path.join(root, 'project')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, 'review.lumen')
}

function seed(projectPath: string): ContextBankResearchSeedWriteRequest {
  return {
    projectPath,
    projectId: 'project-1',
    state: {
      showQuery: 'Recently, My Sister Is Unusual',
      status: 'ready',
      updatedAt: 1_700_000_000_000,
    },
    sources: [{
      id: 'source:plot',
      url: 'https://example.com/plot',
      title: 'Plot',
      site: 'example.com',
      retrievedAt: 1_700_000_000_000,
      contentHash: 'hash-v1',
      text: 'Mitsuki wears a supernatural belt. The heart on the belt fills as the situation develops.',
    }],
    chunks: [{
      id: 'chunk:belt',
      sourceId: 'source:plot',
      ordinal: 0,
      text: 'Mitsuki wears a supernatural belt. The heart on the belt fills as the situation develops.',
    }],
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Context Bank relaxed research search', () => {
  it('returns a strong partial match when an over-specific natural-language query has no all-token FTS match', () => {
    const projectPath = projectFile()
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.replaceResearchSeed(seed(projectPath))
      const result = store.searchResearch({
        projectPath,
        projectId: 'project-1',
        query: 'Mitsuki Hiyori supernatural belt heart gauge episode',
        maxItems: 10,
        maxCharacters: 10_000,
      })

      expect(result.chunks).toEqual([
        expect.objectContaining({ id: 'chunk:belt', sourceId: 'source:plot' }),
      ])
      expect(result.warnings).toContain('Research search relaxed because no chunk matched all query terms.')
    } finally {
      store.close()
    }
  })
})
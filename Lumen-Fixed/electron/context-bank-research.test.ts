import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  ContextBankResearchPrior,
  ContextBankResearchSeedWriteRequest,
  ContextBankResearchState,
} from '../shared/context-bank-research'
import { copyContextBankForSaveAs, openContextBank } from './context-bank'

const roots: string[] = []

function projectFile(folder = 'project', name = 'review.lumen') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-context-research-'))
  roots.push(root)
  const dir = path.join(root, folder)
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, name)
}

const state = (status: ContextBankResearchState['status'] = 'ready'): ContextBankResearchState => ({
  showQuery: 'Recently, My Sister Is Unusual',
  status,
  identity: {
    source: 'anilist',
    externalId: '17745',
    canonicalTitle: 'Saikin, Imouto no Yousu ga Chotto Okashiinda ga.',
    year: 2014,
    format: 'TV',
    episodes: 12,
  },
  updatedAt: 1_700_000_000_000,
})

const seed = (projectPath: string): ContextBankResearchSeedWriteRequest => ({
  projectPath,
  projectId: 'project-1',
  state: state(),
  sources: [{
    id: 'source:guide',
    url: 'https://example.com/episode-guide',
    title: 'Episode guide',
    site: 'example.com',
    retrievedAt: 1_700_000_000_000,
    contentHash: 'hash-v1',
    text: 'Episode 2 opens with the staircase sequence. Later, Mitsuki returns home.',
  }],
  chunks: [
    {
      id: 'chunk:guide:2',
      sourceId: 'source:guide',
      ordinal: 0,
      heading: 'Episode 2',
      text: 'Episode 2 opens with the staircase sequence.',
      episodeNumber: 2,
    },
    {
      id: 'chunk:guide:later',
      sourceId: 'source:guide',
      ordinal: 1,
      heading: 'Later events',
      text: 'Later, Mitsuki returns home.',
    },
  ],
})

const prior = (): ContextBankResearchPrior => ({
  id: 'prior:staircase',
  query: 'staircase reveal',
  text: 'The staircase reveal is probably in episode 2, early in the episode.',
  episodeNumber: 2,
  positionHint: 'early',
  confidence: 0.82,
  evidence: {
    sourceId: 'source:guide',
    chunkId: 'chunk:guide:2',
    excerpt: 'Episode 2 opens with the staircase sequence.',
  },
  provenance: {
    producer: 'lumen-ai',
    analysisVersion: 'research-prior-v1',
    createdAt: 1_700_000_000_100,
  },
})

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('Context Bank show research', () => {
  it('persists research state and an atomic source/chunk seed across reopen', () => {
    const projectPath = projectFile()
    const store = openContextBank(projectPath, 'project-1')
    store.replaceResearchSeed(seed(projectPath))
    expect(store.getResearchStatus({ projectPath, projectId: 'project-1' })).toMatchObject({
      state: { showQuery: 'Recently, My Sister Is Unusual', status: 'ready' },
      sourceCount: 1,
      chunkCount: 2,
      priorCount: 0,
    })
    store.close()

    const reopened = openContextBank(projectPath, 'project-1')
    try {
      expect(reopened.getResearchStatus({ projectPath, projectId: 'project-1' })).toMatchObject({
        state: { identity: { externalId: '17745' } },
        sourceCount: 1,
        chunkCount: 2,
      })
      const result = reopened.searchResearch({
        projectPath,
        projectId: 'project-1',
        query: 'staircase sequence',
        maxItems: 10,
        maxCharacters: 10_000,
      })
      expect(result.chunks[0]).toMatchObject({
        id: 'chunk:guide:2',
        sourceId: 'source:guide',
        sourceUrl: 'https://example.com/episode-guide',
        episodeNumber: 2,
      })
      expect(result.priors).toEqual([])
    } finally {
      reopened.close()
    }
  })

  it('replaces a changed research source atomically and does not leave stale chunks', () => {
    const projectPath = projectFile()
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.replaceResearchSeed(seed(projectPath))
      const changed = seed(projectPath)
      changed.sources[0] = {
        ...changed.sources[0],
        contentHash: 'hash-v2',
        text: 'Episode 5 contains the pudding scene.',
      }
      changed.chunks = [{
        id: 'chunk:guide:5',
        sourceId: 'source:guide',
        ordinal: 0,
        heading: 'Episode 5',
        text: 'Episode 5 contains the pudding scene.',
        episodeNumber: 5,
      }]
      store.replaceResearchSeed(changed)

      const oldResult = store.searchResearch({ projectPath, projectId: 'project-1', query: 'staircase', maxItems: 10, maxCharacters: 10_000 })
      const newResult = store.searchResearch({ projectPath, projectId: 'project-1', query: 'pudding scene', maxItems: 10, maxCharacters: 10_000 })
      expect(oldResult.chunks).toEqual([])
      expect(newResult.chunks).toEqual([expect.objectContaining({ id: 'chunk:guide:5', episodeNumber: 5 })])
      expect(store.getResearchStatus({ projectPath, projectId: 'project-1' })).toMatchObject({ sourceCount: 1, chunkCount: 1 })
    } finally {
      store.close()
    }
  })

  it('requires research priors to cite an existing chunk and a normalized excerpt from it', () => {
    const projectPath = projectFile()
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.replaceResearchSeed(seed(projectPath))
      const written = store.putResearchPrior({ projectPath, projectId: 'project-1', prior: prior() })
      expect(written).toMatchObject({ created: true, prior: { id: 'prior:staircase' } })
      expect(store.putResearchPrior({ projectPath, projectId: 'project-1', prior: prior() })).toMatchObject({ created: false })

      expect(() => store.putResearchPrior({
        projectPath,
        projectId: 'project-1',
        prior: { ...prior(), id: 'prior:missing', evidence: { ...prior().evidence, chunkId: 'chunk:missing' } },
      })).toThrow(/chunk/i)
      expect(() => store.putResearchPrior({
        projectPath,
        projectId: 'project-1',
        prior: { ...prior(), id: 'prior:bad-excerpt', evidence: { ...prior().evidence, excerpt: 'This sentence is not in the cited source.' } },
      })).toThrow(/excerpt/i)

      const result = store.searchResearch({ projectPath, projectId: 'project-1', query: 'staircase reveal', maxItems: 10, maxCharacters: 10_000 })
      expect(result.priors).toEqual([expect.objectContaining({ id: 'prior:staircase', episodeNumber: 2, positionHint: 'early' })])
    } finally {
      store.close()
    }
  })

  it('enforces deterministic item and character budgets for research search', () => {
    const projectPath = projectFile()
    const store = openContextBank(projectPath, 'project-1')
    try {
      store.replaceResearchSeed(seed(projectPath))
      store.putResearchPrior({ projectPath, projectId: 'project-1', prior: prior() })
      const result = store.searchResearch({ projectPath, projectId: 'project-1', query: 'staircase episode', maxItems: 1, maxCharacters: 500 })
      expect(result.priors.length + result.chunks.length).toBeLessThanOrEqual(1)
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(500)
      expect(result.truncated).toBe(true)
    } finally {
      store.close()
    }
  })

  it('preserves research data through Save As and removes only bank data on clear', () => {
    const sourceProject = projectFile('old')
    const targetProject = path.join(path.dirname(path.dirname(sourceProject)), 'new', 'copy.lumen')
    fs.mkdirSync(path.dirname(targetProject), { recursive: true })
    const source = openContextBank(sourceProject, 'project-1')
    try {
      source.replaceResearchSeed(seed(sourceProject))
      source.putResearchPrior({ projectPath: sourceProject, projectId: 'project-1', prior: prior() })
      copyContextBankForSaveAs('project-1', sourceProject, targetProject)

      const target = openContextBank(targetProject, 'project-1')
      try {
        expect(target.getResearchStatus({ projectPath: targetProject, projectId: 'project-1' })).toMatchObject({ sourceCount: 1, chunkCount: 2, priorCount: 1 })
        target.clear()
        expect(target.getResearchStatus({ projectPath: targetProject, projectId: 'project-1' })).toMatchObject({ sourceCount: 0, chunkCount: 0, priorCount: 0 })
      } finally {
        target.close()
      }
    } finally {
      source.close()
    }
  })
})

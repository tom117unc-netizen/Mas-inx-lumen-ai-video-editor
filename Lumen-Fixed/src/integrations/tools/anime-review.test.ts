import { describe, expect, it } from 'vitest'
import { ANIME_REVIEW_TOOLS } from './anime-review'

const EXPECTED_TOOLS = [
  'inspect_all_timelines',
  'list_timeline_markers',
  'edit_timeline_marker',
  'query_context_bank',
  'get_source_transcript',
  'get_source_observations',
  'record_source_observation',
]

describe('ANIME_REVIEW_TOOLS', () => {
  it('contains no sparse or undefined tool entries', () => {
    expect(ANIME_REVIEW_TOOLS).toHaveLength(EXPECTED_TOOLS.length)
    for (let index = 0; index < ANIME_REVIEW_TOOLS.length; index++) {
      expect(Object.prototype.hasOwnProperty.call(ANIME_REVIEW_TOOLS, index)).toBe(true)
      expect(ANIME_REVIEW_TOOLS[index]).toBeDefined()
    }
    expect(ANIME_REVIEW_TOOLS.map((tool) => tool.name)).toEqual(expect.arrayContaining(EXPECTED_TOOLS))
  })

  it('uses unique non-empty tool names', () => {
    const names = ANIME_REVIEW_TOOLS.map((tool) => tool.name)
    expect(names.every((name) => typeof name === 'string' && name.trim().length > 0)).toBe(true)
    expect(new Set(names).size).toBe(names.length)
    for (const expected of EXPECTED_TOOLS) expect(names.filter(name => name === expected)).toHaveLength(1)
  })

  it('does not expose destructive or low-level Context Bank capabilities to the AI', () => {
    const names = ANIME_REVIEW_TOOLS.map(tool => tool.name.join?.('') ?? tool.name)
    expect(names).not.toEqual(expect.arrayContaining(['clear_context_bank', 'execute_context_sql', 'set_source_fingerprint']))
  })
})

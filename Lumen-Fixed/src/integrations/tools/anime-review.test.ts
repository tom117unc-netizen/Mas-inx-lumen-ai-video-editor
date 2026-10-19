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
  'get_show_research_status',
  'search_show_research',
  'record_research_prior',
  'plan_source_scene_search',
  'plan_anime_review_rough_cut',
  'plan_pngtuber_mouth_sync',
  'plan_pngtuber_sprite_replacement',
  'propose_pngtuber_sprite_replacement',
  'propose_pngtuber_mouth_sync',
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

  it('registers mouth sync as an approval proposal rather than a direct mutation tool', () => {
    const tool = ANIME_REVIEW_TOOLS.find(tool => tool.name === 'propose_pngtuber_mouth_sync')
    expect(tool).toBeDefined()
    expect(tool?.description).toMatch(/proposal|review|approval/i)
  })

  it('registers rough cut planning as non-mutating and evidence-aware', () => {
    const tool = ANIME_REVIEW_TOOLS.find(tool => tool.name === 'plan_anime_review_rough_cut')
    expect(tool).toBeDefined()
    expect(tool?.description).toMatch(/plan|non-mutating|verified|evidence/i)
  })

  it('does not expose destructive or low-level Context Bank capabilities to the AI', () => {
    const names = ANIME_REVIEW_TOOLS.map(tool => tool.name)
    expect(names).not.toEqual(expect.arrayContaining([
      'clear_context_bank',
      'execute_context_sql',
      'set_source_fingerprint',
      'set_show_identity',
      'fetch_show_research_url',
    ]))
  })
})
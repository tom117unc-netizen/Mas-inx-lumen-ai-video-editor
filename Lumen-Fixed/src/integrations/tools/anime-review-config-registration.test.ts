import { describe, expect, it } from 'vitest'
import { ANIME_REVIEW_TOOLS } from './anime-review'

describe('configure_anime_review_project tool', () => {
  it('is exposed exactly once to Copilot/MCP agents', () => {
    const tools = ANIME_REVIEW_TOOLS.filter(tool => tool.name === 'configure_anime_review_project')
    expect(tools).toHaveLength(1)
    expect(tools[0]?.description).toMatch(/existing|show|research/i)
  })
})

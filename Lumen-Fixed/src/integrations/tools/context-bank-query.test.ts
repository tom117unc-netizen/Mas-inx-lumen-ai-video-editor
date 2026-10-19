import { describe, expect, it } from 'vitest'
import { makeContextBankQuery } from './context-bank-query'

describe('makeContextBankQuery', () => {
  it('builds a bounded saved-project query with conservative defaults', () => {
    expect(makeContextBankQuery(
      { purpose: 'inspect the cut around this chapter boundary', sequence_id: 'main', start_frame: 100, end_frame: 180 },
      'D:\\Reviews\\review.lumen',
      'project-1',
    )).toEqual({
      projectPath: 'D:\\Reviews\\review.lumen',
      projectId: 'project-1',
      sequenceId: 'main',
      startFrame: 100,
      endFrame: 180,
      purpose: 'inspect the cut around this chapter boundary',
      maxItems: 80,
      maxCharacters: 12000,
    })
  })

  it('caps model-requested budgets instead of allowing an unbounded context dump', () => {
    const query = makeContextBankQuery(
      { purpose: 'review context', max_items: 50000, max_characters: 10_000_000 },
      'D:\\Reviews\\review.lumen',
      'project-1',
    )
    expect(query.maxItems).toBe(200)
    expect(query.maxCharacters).toBe(28000)
  })

  it('requires a saved project, a purpose, and a valid frame range', () => {
    expect(() => makeContextBankQuery({ purpose: 'context' }, null, 'project-1')).toThrow(/save the project/i)
    expect(() => makeContextBankQuery({}, 'D:\\Reviews\\review.lumen', 'project-1')).toThrow(/purpose/i)
    expect(() => makeContextBankQuery({ purpose: 'context', start_frame: 20, end_frame: 20 }, 'D:\\Reviews\\review.lumen', 'project-1')).toThrow(/after start/i)
    expect(() => makeContextBankQuery({ purpose: 'context', start_frame: -1 }, 'D:\\Reviews\\review.lumen', 'project-1')).toThrow(/start_frame/i)
  })

  it('normalizes numeric budgets to positive integers and trims optional ids', () => {
    const query = makeContextBankQuery(
      { purpose: '  find nearby edit context  ', sequence_id: '  nested-1  ', max_items: 3.9, max_characters: 900.8 },
      'D:\\Reviews\\review.lumen',
      'project-1',
    )
    expect(query).toMatchObject({
      purpose: 'find nearby edit context',
      sequenceId: 'nested-1',
      maxItems: 3,
      maxCharacters: 900,
    })
  })
})

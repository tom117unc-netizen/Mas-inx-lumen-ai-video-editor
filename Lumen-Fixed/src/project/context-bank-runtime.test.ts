import { describe, expect, it, vi } from 'vitest'
import { createEmptyProject } from '@/editor/new-project'
import { contextBankPathAction, runAnimeResearchAfterContextBankSync } from './context-bank-runtime'

describe('contextBankPathAction', () => {
  it('copies only a Save As transition for the same loaded project', () => {
    expect(contextBankPathAction('D:\\A\\old.lumen', 'D:\\B\\copy.lumen', 'project-1', 'project-1', false)).toBe('copy')
  })

  it('never copies when a project load caused the path transition', () => {
    expect(contextBankPathAction('D:\\A\\old.lumen', 'D:\\B\\other.lumen', 'project-1', 'project-1', true)).toBe('reconcile')
    expect(contextBankPathAction('D:\\A\\old.lumen', 'D:\\B\\other.lumen', 'project-1', 'project-2', true)).toBe('reconcile')
  })

  it('reconciles the first save and a different project, and does nothing when becoming unsaved', () => {
    expect(contextBankPathAction(null, 'D:\\B\\first-save.lumen', 'project-1', 'project-1', false)).toBe('reconcile')
    expect(contextBankPathAction('D:\\A\\old.lumen', 'D:\\B\\other.lumen', 'project-1', 'project-2', false)).toBe('reconcile')
    expect(contextBankPathAction('D:\\A\\old.lumen', null, 'project-1', 'project-2', true)).toBe('none')
  })
})

describe('anime research runtime ordering', () => {
  it('reconciles the Context Bank before seeding a saved anime-review project', async () => {
    const events: string[] = []
    const project = createEmptyProject('Frieren', {}, { version: 1, showQuery: 'Frieren' })
    const reconcile = vi.fn(async () => { events.push('reconcile') })
    const seed = vi.fn(async () => { events.push('seed') })

    await runAnimeResearchAfterContextBankSync(project, 'D:\\Reviews\\Frieren.lumen', reconcile, seed)

    expect(events).toEqual(['reconcile', 'seed'])
    expect(seed).toHaveBeenCalledWith(project, 'D:\\Reviews\\Frieren.lumen')
  })

  it('still reconciles generic saved projects but never seeds generic or unsaved projects', async () => {
    const generic = createEmptyProject('Generic')
    const review = createEmptyProject('Frieren', {}, { version: 1, showQuery: 'Frieren' })
    const reconcile = vi.fn(async () => {})
    const seed = vi.fn(async () => {})

    await runAnimeResearchAfterContextBankSync(generic, 'D:\\Reviews\\Generic.lumen', reconcile, seed)
    await runAnimeResearchAfterContextBankSync(review, null, reconcile, seed)

    expect(reconcile).toHaveBeenCalledTimes(1)
    expect(seed).not.toHaveBeenCalled()
  })
})

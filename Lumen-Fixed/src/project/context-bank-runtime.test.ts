import { describe, expect, it } from 'vitest'
import { contextBankPathAction } from './context-bank-runtime'

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

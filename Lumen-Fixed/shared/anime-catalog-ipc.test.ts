import { describe, expect, it } from 'vitest'
import { IPC } from './integrations'

describe('anime catalog integration surface', () => {
  it('uses one dedicated trusted IPC channel for catalogue resolution', () => {
    expect(IPC.animeCatalogResolve).toBe('lumen:anime-catalog:resolve')
  })
})

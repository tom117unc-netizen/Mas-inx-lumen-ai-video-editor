import type { AnimeCatalogResolveResult } from './anime-catalog'
import { IPC as BASE_IPC } from './integrations-base'
import type { IntegrationsAPI as BaseIntegrationsAPI } from './integrations-base'

export * from './integrations-base'

/** Stable renderer/main-process channel names, including anime catalogue lookup. */
export const IPC = {
  ...BASE_IPC,
  animeCatalogResolve: 'lumen:anime-catalog:resolve',
} as const

/** Adds bounded public anime identity resolution to Lumen's existing integration surface. */
export interface IntegrationsAPI extends BaseIntegrationsAPI {
  animeCatalog: {
    resolve(query: string): Promise<AnimeCatalogResolveResult>
  }
}

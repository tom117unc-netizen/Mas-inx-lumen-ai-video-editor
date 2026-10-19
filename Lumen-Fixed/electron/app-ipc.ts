import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { APP_IPC } from '../shared/app'
import type { ContextBankObservationQuery, ContextBankObservationWriteRequest } from '../shared/context-bank-analysis'
import { registerAppIpc as registerCoreAppIpc } from './app-ipc-core'
import { openContextBank } from './context-bank'

/**
 * Registers the desktop app IPC surface, then adds the reusable-analysis
 * Context Bank endpoints. The sender trust rule remains identical to the core
 * app IPC boundary; store-level validation owns the detailed payload checks.
 */
export function registerAppIpc(isTrustedUrl: (url: string) => boolean, getStartupFile: () => string | null) {
  registerCoreAppIpc(isTrustedUrl, getStartupFile)

  const trusted = (event: IpcMainInvokeEvent) => isTrustedUrl(event.senderFrame?.url ?? '')
  const str = (value: unknown) => (typeof value === 'string' ? value : '')
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!trusted(event)) throw new Error('Blocked: untrusted sender')
      return fn(...(args as A))
    })
  }

  handle(APP_IPC.contextBankPutObservations, (value: unknown) => {
    const request = value as Partial<ContextBankObservationWriteRequest>
    const projectPath = str(request?.projectPath)
    const projectId = str(request?.projectId)
    if (!projectPath || !projectId || !str(request?.assetId) || !Array.isArray(request?.observations)) {
      throw new Error('Invalid Context Bank observation write request')
    }
    const store = openContextBank(projectPath, projectId)
    try { return store.putObservations(request as ContextBankObservationWriteRequest) } finally { store.close() }
  })

  handle(APP_IPC.contextBankGetObservations, (value: unknown) => {
    const request = value as Partial<ContextBankObservationQuery>
    const projectPath = str(request?.projectPath)
    const projectId = str(request?.projectId)
    if (!projectPath || !projectId || !str(request?.assetId)) throw new Error('Invalid Context Bank observation query')
    const store = openContextBank(projectPath, projectId)
    try { return store.getObservations(request as ContextBankObservationQuery) } finally { store.close() }
  })
}
